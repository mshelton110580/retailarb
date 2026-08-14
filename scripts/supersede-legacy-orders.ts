// Tombstone legacy composite-id duplicate orders by pointing them at their modern twin.
// NON-DESTRUCTIVE: only writes orders.superseded_by_order_id on legacy rows; nothing is deleted.
//
// Legacy id format: "<itemId>-<transactionId>" (fails the modern NN-NNNNN-NNNNN pattern).
// Twin key is deterministic: the modern order containing an order_item with that exact
// item_id AND transaction_id. Legacy orders with zero or multiple twins are never touched.
//
// Usage:
//   (no args)   dry-run: print every legacy -> twin pair with both shipment statuses; write nothing
//   --apply     write superseded_by_order_id markers
//   --restore   null ALL superseded_by_order_id markers (full undo)
import { prisma } from "../src/lib/db";

const MODERN = /^\d{2}-\d{5}-\d{5}$/;

async function main() {
  const mode = process.argv[2] ?? "";

  if (mode === "--restore") {
    const res = await prisma.orders.updateMany({
      where: { superseded_by_order_id: { not: null } },
      data: { superseded_by_order_id: null }
    });
    console.log(`Restored: cleared superseded marker on ${res.count} order(s).`);
    return;
  }

  const apply = mode === "--apply";
  const orders = await prisma.orders.findMany({ select: { order_id: true, superseded_by_order_id: true } });
  const legacy = orders.filter(o => !MODERN.test(o.order_id));
  console.log(`orders total=${orders.length}, legacy-format=${legacy.length} (${apply ? "APPLY" : "dry-run"})`);

  let marked = 0, alreadyMarked = 0, skipped = 0;
  for (const o of legacy) {
    if (o.superseded_by_order_id) { alreadyMarked++; continue; }
    const m = o.order_id.match(/^(\d+)-(\d+)$/);
    const twins = m
      ? [...new Set((await prisma.order_items.findMany({
          where: { item_id: m[1], transaction_id: m[2], NOT: { order_id: o.order_id } },
          select: { order_id: true }
        })).map(t => t.order_id))].filter(id => MODERN.test(id))
      : [];

    if (twins.length !== 1) {
      skipped++;
      console.log(`  SKIP ${o.order_id}: ${twins.length === 0 ? "no modern twin" : `ambiguous twins ${twins.join(", ")}`} — left untouched, review manually`);
      continue;
    }

    const [legacyShip, twinShip] = await Promise.all([
      prisma.shipments.findFirst({ where: { order_id: o.order_id }, select: { derived_status: true } }),
      prisma.shipments.findFirst({ where: { order_id: twins[0] }, select: { derived_status: true } })
    ]);
    console.log(`  ${o.order_id} (${legacyShip?.derived_status ?? "no shipment"}) -> superseded by ${twins[0]} (${twinShip?.derived_status ?? "no shipment"})`);

    if (apply) {
      await prisma.orders.update({ where: { order_id: o.order_id }, data: { superseded_by_order_id: twins[0] } });
    }
    marked++;
  }

  console.log(`\n${apply ? "Marked" : "Would mark"}: ${marked}; already marked: ${alreadyMarked}; skipped (no/ambiguous twin): ${skipped}`);
  if (!apply) console.log("Dry run — nothing written. Re-run with --apply to execute. Undo anytime with --restore.");
}

main().finally(() => prisma.$disconnect());
