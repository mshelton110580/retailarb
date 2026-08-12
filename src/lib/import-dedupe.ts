// Decides, for one CSV import row targeting one order, how many units to create
// vs skip. A row's units occupy cumulative indices (requestedSoFar, requestedSoFar+qty]
// for the order; indices at or below preRunExisting were created by a previous
// import/scan run and must not be recreated.

export interface RowImportPlan {
  createCount: number;
  skipCount: number;
}

export function planRowImport(input: { qty: number; requestedSoFar: number; preRunExisting: number }): RowImportPlan {
  const { qty, requestedSoFar, preRunExisting } = input;
  const skipCount = Math.max(0, Math.min(preRunExisting - requestedSoFar, qty));
  return { createCount: qty - skipCount, skipCount };
}
