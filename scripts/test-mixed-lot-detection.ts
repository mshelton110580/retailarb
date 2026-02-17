import { detectMultipleProducts } from "../src/lib/item-categorization";

const testCases = [
  // Should detect multiple products
  { title: "Texas Instruments TI-84 Plus & TI-83 Plus Graphing Calculator", expected: true },
  { title: "Xbox Series X + PS5 Console Bundle", expected: true },
  { title: "iPhone 13 Pro and AirPods Pro 2nd Gen", expected: true },
  { title: "Lot of 10 TI-84 Plus Calculators", expected: true },

  // Should NOT detect multiple products
  { title: "TI-84 Plus CE Pink Graphing Calculator", expected: false },
  { title: "iPhone 13 Pro with Case", expected: false },
  { title: "Xbox Series X Console", expected: false },
];

console.log("=== Mixed Lot Detection Tests ===\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const result = detectMultipleProducts(test.title);
  const status = result === test.expected ? "✓ PASS" : "✗ FAIL";

  if (result === test.expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status}: "${test.title}"`);
  console.log(`  Expected: ${test.expected}, Got: ${result}\n`);
}

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);

process.exit(failed > 0 ? 1 : 0);
