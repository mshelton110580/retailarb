import { prisma } from "../src/lib/db";
import { planInventoryTransitions, applyInventoryTransitions } from "../src/lib/inventory-transitions";

async function backfillCaseLinks(dry: boolean): Promise<number> {
  const escalated = await prisma.returns.findMany({
    where: { escalated: true, case_id: null, order_id: { not: null }, ebay_item_id: { not: null } },
    select: { id: true, order_id: true, ebay_item_id: true, ebay_return_id: true }
  });
  let linked = 0;
  for (const r of escalated) {
    const cs = await prisma.inr_cases.findFirst({
      where: { order_id: r.order_id!, ebay_item_id: r.ebay_item_id!, case_id: { not: null } },
      select: { case_id: true, ebay_status: true }
    });
    if (!cs?.case_id) { console.log(`  return ${r.ebay_return_id}: NO matching case found`); continue; }
    console.log(`  return ${r.ebay_return_id} -> case ${cs.case_id} (${cs.ebay_status})`);
    if (!dry) await prisma.returns.update({ where: { id: r.id }, data: { case_id: cs.case_id } });
    linked++;
  }
  return linked;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--restore") {
    const batch = args[1];
    if (!batch) throw new Error("Usage: --restore <batch_label>");
    const rows = await prisma.inventory_state_snapshots.findMany({ where: { batch_label: batch } });
    if (rows.length === 0) throw new Error(`No snapshot rows for batch ${batch}`);
    for (const row of rows) {
      await prisma.received_units.update({ where: { id: row.unit_id }, data: { inventory_state: row.inventory_state } });
    }
    console.log(`Restored ${rows.length} unit states from batch ${batch}`);
    return;
  }

  const apply = args[0] === "--apply";
  console.log(`=== Case-link backfill (${apply ? "APPLY" : "dry-run"}) ===`);
  const linked = await backfillCaseLinks(!apply);
  console.log(`${linked} return->case link(s)\n=== State transitions (${apply ? "APPLY" : "dry-run"}) ===`);

  const plan = await planInventoryTransitions();
  const byPair = new Map<string, number>();
  for (const t of plan) {
    console.log(`  ${t.unitId} (order ${t.orderId}): ${t.from} -> ${t.to} — ${t.reason}`);
    byPair.set(`${t.from} -> ${t.to}`, (byPair.get(`${t.from} -> ${t.to}`) ?? 0) + 1);
  }
  console.log(`\nSummary (${plan.length} transitions):`);
  for (const [k, n] of byPair) console.log(`  ${k}: ${n}`);

  if (apply && plan.length > 0) {
    const batch = `reclassify-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    await prisma.inventory_state_snapshots.createMany({
      data: plan.map(t => ({ unit_id: t.unitId, inventory_state: t.from, batch_label: batch }))
    });
    console.log(`\nSnapshot saved: batch_label=${batch} (${plan.length} rows). Restore with: --restore ${batch}`);
    await applyInventoryTransitions(plan);
    console.log("Applied.");
  } else if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to execute.");
  }
}

main().finally(() => prisma.$disconnect());
