import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import {
  planInventoryTransitions,
  applyInventoryTransitions,
  type PlannedTransition,
  type Db
} from "../src/lib/inventory-transitions";

const RESTORE_NOTE = "note: --restore reverts unit states only; case links are re-derived by sync and are not reverted.";

async function backfillCaseLinks(db: Db): Promise<number> {
  const escalated = await db.returns.findMany({
    where: { escalated: true, case_id: null, order_id: { not: null }, ebay_item_id: { not: null } },
    select: { id: true, order_id: true, ebay_item_id: true, ebay_return_id: true }
  });
  let linked = 0;
  for (const r of escalated) {
    const cs = await db.inr_cases.findFirst({
      where: { order_id: r.order_id!, ebay_item_id: r.ebay_item_id!, case_id: { not: null } },
      orderBy: { creation_date: { sort: "desc", nulls: "last" } },
      select: { case_id: true, ebay_status: true }
    });
    if (!cs?.case_id) { console.log(`  return ${r.ebay_return_id}: NO matching case found`); continue; }
    console.log(`  return ${r.ebay_return_id} -> case ${cs.case_id} (${cs.ebay_status})`);
    await db.returns.update({ where: { id: r.id }, data: { case_id: cs.case_id } });
    linked++;
  }
  return linked;
}

function printPlan(plan: PlannedTransition[]) {
  const byPair = new Map<string, number>();
  for (const t of plan) {
    console.log(`  ${t.unitId} (order ${t.orderId}): ${t.from} -> ${t.to} — ${t.reason}`);
    byPair.set(`${t.from} -> ${t.to}`, (byPair.get(`${t.from} -> ${t.to}`) ?? 0) + 1);
  }
  console.log(`\nSummary (${plan.length} transitions):`);
  for (const [k, n] of byPair) console.log(`  ${k}: ${n}`);
}

// Sentinel thrown to unwind $transaction without committing. Never surfaced.
const ROLLBACK = Symbol("dry-run-rollback");

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
    console.log(RESTORE_NOTE);
    return;
  }

  const apply = args[0] === "--apply";

  if (apply) {
    // Apply mode: backfill commits for real, then plan against the
    // now-committed case links, then snapshot + apply.
    console.log(`=== Case-link backfill (APPLY) ===`);
    const linked = await backfillCaseLinks(prisma);
    console.log(`${linked} return->case link(s)\n=== State transitions (APPLY) ===`);

    const plan = await planInventoryTransitions(prisma);
    printPlan(plan);

    if (plan.length > 0) {
      const batch = `reclassify-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
      await prisma.inventory_state_snapshots.createMany({
        data: plan.map(t => ({ unit_id: t.unitId, inventory_state: t.from, batch_label: batch }))
      });
      console.log(`\nSnapshot saved: batch_label=${batch} (${plan.length} rows). Restore with: --restore ${batch}`);
      await applyInventoryTransitions(plan, prisma);
      console.log("Applied.");
    }
    console.log(RESTORE_NOTE);
    return;
  }

  // Dry-run mode: run the SAME backfill-then-plan sequence apply would run,
  // inside a transaction, then roll it back — so the printed plan is exactly
  // what --apply will produce (case-link backfill included), not a stale
  // preview computed against un-backfilled data.
  console.log(`=== Case-link backfill (dry-run) ===`);
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const linked = await backfillCaseLinks(tx);
      console.log(`${linked} return->case link(s)\n=== State transitions (dry-run) ===`);

      const plan = await planInventoryTransitions(tx);
      printPlan(plan);

      throw ROLLBACK;
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  console.log("\nDry run — nothing written. Re-run with --apply to execute.");
  console.log(RESTORE_NOTE);
}

main().finally(() => prisma.$disconnect());
