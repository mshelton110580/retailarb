// Read-only sanity check: for real checked-in lot shipments in the current DB,
// confirm the new import dedupe (planRowImport) would skip an exact reimport.
// Run: npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/check-lot-reimport-guard.ts
import { PrismaClient } from "@prisma/client";
import { planRowImport } from "../src/lib/import-dedupe";

const prisma = new PrismaClient();

async function main() {
  const lots = await prisma.shipments.findMany({
    where: { is_lot: true, checked_in_at: { not: null } },
    orderBy: { checked_in_at: "desc" },
    take: 5,
    select: { id: true, order_id: true, expected_units: true, scanned_units: true }
  });

  for (const s of lots) {
    const existing = await prisma.received_units.count({ where: { order_id: s.order_id } });
    // Simulate reimporting the original sheet: one row per existing unit, qty 1 each
    let requested = 0;
    let wouldCreate = 0;
    for (let i = 0; i < existing; i++) {
      const plan = planRowImport({ qty: 1, requestedSoFar: requested, preRunExisting: existing });
      requested += 1;
      wouldCreate += plan.createCount;
    }
    // Old behavior: is_lot=true bypassed the guard → every row created a unit
    console.log(
      `order ${s.order_id} — expected ${s.expected_units}, existing ${existing}: ` +
      `reimport would create ${wouldCreate} (old code: ${existing}) ${wouldCreate === 0 ? "OK" : "FAIL"}`
    );
  }
}

main().finally(() => prisma.$disconnect());
