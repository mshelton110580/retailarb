/**
 * Trace through the refund logic step by step
 */

// Simulating order 22-14005-91657
const estimatedRefund = 290; // Original total
const currentTotal = 195;    // Current total in database
const refundAmount = estimatedRefund - currentTotal; // 95

const unitsScanned = 10;
const badUnitsCount = 3;

console.log("=== Order 22-14005-91657 Simulation ===\n");
console.log(`Estimated Refund (original): $${estimatedRefund}`);
console.log(`Current Total: $${currentTotal}`);
console.log(`Calculated Refund: $${refundAmount}`);
console.log(`\nTotal Units: ${unitsScanned}`);
console.log(`Bad Units: ${badUnitsCount}`);

const totalCost = estimatedRefund; // Use ORIGINAL total, not current
const perUnitCost = totalCost / unitsScanned;

console.log(`\n=== Cost Calculation ===`);
console.log(`Total Cost: $${totalCost}`);
console.log(`Per-Unit Cost: $${perUnitCost.toFixed(2)}`);

console.log(`\n=== Refund Distribution ===`);
console.log(`Refund Amount: $${refundAmount}`);
console.log(`Partial refund? ${refundAmount > 0 && refundAmount < totalCost} (${refundAmount} < ${totalCost})`);
console.log(`Multiple units? ${unitsScanned > 1}`);

if (refundAmount > 0 && refundAmount < totalCost && unitsScanned > 1) {
  console.log("\n✓ Entering partial refund logic (lots with partial refunds)");

  if (badUnitsCount === 0) {
    console.log("  All units are good - distribute equally");
    const itemCost = (totalCost - refundAmount) / unitsScanned;
    console.log(`  Item cost: $${itemCost.toFixed(2)}`);
  } else {
    console.log("  Mixed good/bad units - distribute among bad units only");

    const expectedBadRefund = perUnitCost * badUnitsCount;
    const refundMatchesBadUnits = Math.abs(refundAmount - expectedBadRefund) < 1;

    console.log(`  Expected bad refund: $${expectedBadRefund.toFixed(2)}`);
    console.log(`  Actual refund: $${refundAmount}`);
    console.log(`  Refund matches? ${refundMatchesBadUnits}`);

    if (refundMatchesBadUnits) {
      console.log("\n  Refund matches bad units perfectly:");
      console.log(`    Bad unit cost: $0 (fully refunded)`);
      console.log(`    Good unit cost: $${perUnitCost.toFixed(2)}`);
    } else {
      console.log("\n  Partial refund doesn't match - distribute among bad units:");
      const refundPerBadUnit = refundAmount / badUnitsCount;
      const badUnitCost = Math.max(0, perUnitCost - refundPerBadUnit);

      console.log(`    Refund per bad unit: $${refundPerBadUnit.toFixed(2)}`);
      console.log(`    Bad unit cost: max(0, $${perUnitCost.toFixed(2)} - $${refundPerBadUnit.toFixed(2)}) = $${badUnitCost.toFixed(2)}`);
      console.log(`    Good unit cost: $${perUnitCost.toFixed(2)}`);

      console.log(`\n=== Final Summary ===`);
      console.log(`Good units (7): $${perUnitCost.toFixed(2)} each = $${(perUnitCost * 7).toFixed(2)} total`);
      console.log(`Bad units (3): $${badUnitCost.toFixed(2)} each = $${(badUnitCost * 3).toFixed(2)} total`);
      console.log(`Total value: $${(perUnitCost * 7 + badUnitCost * 3).toFixed(2)}`);
      console.log(`Expected: $${(currentTotal - refundAmount).toFixed(2)} (current - refund)`);
    }
  }
}

console.log("\n=== Verification ===");
const refundPerBadUnit = refundAmount / badUnitsCount;
const badUnitCost = Math.max(0, perUnitCost - refundPerBadUnit);
const totalValueGood = perUnitCost * (unitsScanned - badUnitsCount);
const totalValueBad = badUnitCost * badUnitsCount;
const totalInventoryValue = totalValueGood + totalValueBad;
const expectedValue = currentTotal - refundAmount;

console.log(`Total inventory value: $${totalInventoryValue.toFixed(2)}`);
console.log(`Expected value (current - refund): $${expectedValue.toFixed(2)}`);
console.log(`Match? ${Math.abs(totalInventoryValue - expectedValue) < 0.01 ? "✓ YES" : "✗ NO"}`);
