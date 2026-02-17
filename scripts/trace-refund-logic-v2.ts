/**
 * Trace through the NEW refund logic step by step
 */

// Simulating order 22-14005-91657
const estimatedRefund = 290; // Original total
const currentTotal = 195;    // Current total in database
const refundAmount = estimatedRefund - currentTotal; // 95

const unitsScanned = 10;
const badUnitsCount = 3;
const goodUnitsCount = unitsScanned - badUnitsCount;

console.log("=== Order 22-14005-91657 Simulation (NEW LOGIC) ===\n");
console.log(`Original Total (estimated_refund): $${estimatedRefund}`);
console.log(`Current Total: $${currentTotal}`);
console.log(`Calculated Refund: $${refundAmount}`);
console.log(`\nTotal Units: ${unitsScanned}`);
console.log(`Bad Units: ${badUnitsCount}`);
console.log(`Good Units: ${goodUnitsCount}`);

const totalCost = estimatedRefund; // Use ORIGINAL total
const perUnitCost = totalCost / unitsScanned;

console.log(`\n=== Cost Calculation ===`);
console.log(`Total Cost (original): $${totalCost}`);
console.log(`Per-Unit Cost (original): $${perUnitCost.toFixed(2)}`);

console.log(`\n=== Refund Distribution (NEW LOGIC) ===`);
console.log(`Refund Amount: $${refundAmount}`);

const badUnitsTotalCost = perUnitCost * badUnitsCount;
console.log(`Bad units total cost: $${perUnitCost.toFixed(2)} × ${badUnitsCount} = $${badUnitsTotalCost.toFixed(2)}`);
console.log(`Refund exceeds bad units cost? ${refundAmount} > ${badUnitsTotalCost.toFixed(2)} = ${refundAmount > badUnitsTotalCost}`);

let badUnitCost, goodUnitCost;

if (refundAmount <= badUnitsTotalCost) {
  console.log("\n  Branch: Refund ≤ bad units cost - apply only to bad units");
  const refundPerBadUnit = refundAmount / badUnitsCount;
  badUnitCost = Math.max(0, perUnitCost - refundPerBadUnit);
  goodUnitCost = perUnitCost;

  console.log(`  Refund per bad unit: $${refundPerBadUnit.toFixed(2)}`);
  console.log(`  Bad unit cost: $${perUnitCost.toFixed(2)} - $${refundPerBadUnit.toFixed(2)} = $${badUnitCost.toFixed(2)}`);
  console.log(`  Good unit cost: $${goodUnitCost.toFixed(2)} (unchanged)`);
} else {
  console.log("\n  Branch: Refund > bad units cost - zero out bad units, apply remainder to good units");
  badUnitCost = 0;
  const remainingRefund = refundAmount - badUnitsTotalCost;
  const refundPerGoodUnit = remainingRefund / goodUnitsCount;
  goodUnitCost = Math.max(0, perUnitCost - refundPerGoodUnit);

  console.log(`  Bad units zeroed out: $0`);
  console.log(`  Remaining refund: $${refundAmount} - $${badUnitsTotalCost.toFixed(2)} = $${remainingRefund.toFixed(2)}`);
  console.log(`  Refund per good unit: $${remainingRefund.toFixed(2)} / ${goodUnitsCount} = $${refundPerGoodUnit.toFixed(2)}`);
  console.log(`  Good unit cost: $${perUnitCost.toFixed(2)} - $${refundPerGoodUnit.toFixed(2)} = $${goodUnitCost.toFixed(2)}`);
}

console.log(`\n=== Final Summary ===`);
const totalValueGood = goodUnitCost * goodUnitsCount;
const totalValueBad = badUnitCost * badUnitsCount;
const totalInventoryValue = totalValueGood + totalValueBad;

console.log(`Good units (${goodUnitsCount}): $${goodUnitCost.toFixed(2)} each = $${totalValueGood.toFixed(2)} total`);
console.log(`Bad units (${badUnitsCount}): $${badUnitCost.toFixed(2)} each = $${totalValueBad.toFixed(2)} total`);
console.log(`Total inventory value: $${totalInventoryValue.toFixed(2)}`);

const expectedValue = estimatedRefund - refundAmount;
console.log(`\nExpected value (original - refund): $${estimatedRefund} - $${refundAmount} = $${expectedValue.toFixed(2)}`);
console.log(`Match? ${Math.abs(totalInventoryValue - expectedValue) < 0.01 ? "✓ YES" : "✗ NO"}`);

if (Math.abs(totalInventoryValue - expectedValue) < 0.01) {
  console.log("\n✅ SUCCESS! The refund distribution is correct.");
} else {
  console.log("\n❌ ERROR! The totals don't match.");
  console.log(`Difference: $${Math.abs(totalInventoryValue - expectedValue).toFixed(2)}`);
}
