// Test for src/lib/import-dedupe.ts — planRowImport()
// Run: npx ts-node --transpile-only scripts/test-import-dedupe.ts
//
// planRowImport decides, for one CSV row targeting one order, how many units to
// create vs skip, given:
//   qty             — units this row requests
//   requestedSoFar  — cumulative qty already requested for this order earlier in THIS run
//   preRunExisting  — units that existed for this order BEFORE this run started
// Rule: a row's units occupy indices (requestedSoFar, requestedSoFar+qty]; only
// indices beyond preRunExisting are created — the rest were imported previously.

import { planRowImport } from "../src/lib/import-dedupe";

let failed = 0;
function check(name: string, actual: { createCount: number; skipCount: number }, expected: { createCount: number; skipCount: number }) {
  const ok = actual.createCount === expected.createCount && actual.skipCount === expected.skipCount;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}` + (ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}

// Fresh import, single-unit row
check("fresh import creates all units",
  planRowImport({ qty: 1, requestedSoFar: 0, preRunExisting: 0 }),
  { createCount: 1, skipCount: 0 });

// Fresh import, multi-qty row
check("fresh multi-qty row creates all units",
  planRowImport({ qty: 4, requestedSoFar: 0, preRunExisting: 0 }),
  { createCount: 4, skipCount: 0 });

// Fresh lot: same tracking repeated in one run — every row creates
check("fresh lot row 2 creates (within-run repeat)",
  planRowImport({ qty: 1, requestedSoFar: 1, preRunExisting: 0 }),
  { createCount: 1, skipCount: 0 });
check("fresh lot row 3 creates (within-run repeat)",
  planRowImport({ qty: 1, requestedSoFar: 2, preRunExisting: 0 }),
  { createCount: 1, skipCount: 0 });

// Exact reimport of a 3-unit lot: all three rows skip
check("lot reimport row 1 skips",
  planRowImport({ qty: 1, requestedSoFar: 0, preRunExisting: 3 }),
  { createCount: 0, skipCount: 1 });
check("lot reimport row 2 skips",
  planRowImport({ qty: 1, requestedSoFar: 1, preRunExisting: 3 }),
  { createCount: 0, skipCount: 1 });
check("lot reimport row 3 skips",
  planRowImport({ qty: 1, requestedSoFar: 2, preRunExisting: 3 }),
  { createCount: 0, skipCount: 1 });

// Reimport of sheet with a NEW scan appended after the 3 originals
check("appended row 4 creates the new unit",
  planRowImport({ qty: 1, requestedSoFar: 3, preRunExisting: 3 }),
  { createCount: 1, skipCount: 0 });

// Multi-qty row straddling the boundary: 3 existing, row covers indices 3-4
check("row straddling boundary creates only the excess",
  planRowImport({ qty: 2, requestedSoFar: 2, preRunExisting: 3 }),
  { createCount: 1, skipCount: 1 });

// Reimport against a partially checked-in shipment (1 of 2 previously imported)
check("partial check-in reimport skips row 1",
  planRowImport({ qty: 1, requestedSoFar: 0, preRunExisting: 1 }),
  { createCount: 0, skipCount: 1 });
check("partial check-in reimport creates row 2",
  planRowImport({ qty: 1, requestedSoFar: 1, preRunExisting: 1 }),
  { createCount: 1, skipCount: 0 });

if (failed > 0) {
  console.log(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tests passed");
