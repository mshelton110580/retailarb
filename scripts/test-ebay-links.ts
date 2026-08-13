// Test for src/lib/ebay-links.ts — buildReturnUrl() / buildInrUrl()
// Run: npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-ebay-links.ts
//
// buildReturnUrl/buildInrUrl build direct eBay case-filing links from an
// order id and an item's { itemId, transactionId }. When transactionId is
// present, link directly to the item-scoped eBay flow; otherwise fall back
// to the generic order page.

import { buildReturnUrl, buildInrUrl, type EbayLinkItem } from "../src/lib/ebay-links";

let failed = 0;
function check(name: string, actual: string, expected: string) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}` + (ok ? "" : ` — expected ${expected}, got ${actual}`));
}

const itemWithTxn: EbayLinkItem = { itemId: "318", transactionId: "77" };
const itemNullTxn: EbayLinkItem = { itemId: "318", transactionId: null };

check("buildReturnUrl with transactionId",
  buildReturnUrl("07-1", itemWithTxn),
  "https://www.ebay.com/rtn/Return/ReturnViewSelectedItem?itemId=318&transactionId=77");

check("buildInrUrl with transactionId",
  buildInrUrl("07-1", itemWithTxn),
  "https://www.ebay.com/ItemNotReceived/CreateRequest?itemId=318&transactionId=77");

check("buildReturnUrl with null transactionId falls back to order page",
  buildReturnUrl("07-1", itemNullTxn),
  "https://order.ebay.com/ord/show?orderId=07-1");

check("buildInrUrl with null transactionId falls back to order page",
  buildInrUrl("07-1", itemNullTxn),
  "https://order.ebay.com/ord/show?orderId=07-1");

check("buildReturnUrl with undefined item falls back to order page",
  buildReturnUrl("07-1", undefined),
  "https://order.ebay.com/ord/show?orderId=07-1");

check("buildInrUrl with undefined item falls back to order page",
  buildInrUrl("07-1", undefined),
  "https://order.ebay.com/ord/show?orderId=07-1");

if (failed > 0) {
  console.log(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tests passed");
