import { getValidAccessToken } from "../src/lib/ebay/token";

const accountId = "cmll8dvd90001prri3d0mvn6k";
const orderId = "02-14164-85361";
const targetItemId = "236573070455";
const orderLineItemId1 = "236573070455-10078369286002";
const orderLineItemId2 = "236559529653-10078369285902";

async function main() {
  const { token } = await getValidAccessToken(accountId);

  // 1. Fulfillment API - getOrder (RESTful, may have per-line refund info)
  console.log("=== 1. FULFILLMENT API - GET ORDER ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${orderId}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    const data = await resp.json();
    if (data.errors) {
      console.log("Error:", JSON.stringify(data.errors, null, 2));
    } else {
      console.log("OrderTotal:", JSON.stringify(data.pricingSummary));
      console.log("CancelStatus:", data.cancelStatus?.cancelState);
      if (data.lineItems) {
        for (const li of data.lineItems) {
          console.log(`\n  LineItem: ${li.legacyItemId} (${li.title})`);
          console.log("    qty:", li.quantity);
          console.log("    lineItemCost:", JSON.stringify(li.lineItemCost));
          console.log("    total:", JSON.stringify(li.total));
          console.log("    discountedLineItemCost:", JSON.stringify(li.discountedLineItemCost));
          console.log("    refunds:", JSON.stringify(li.refunds, null, 2));
          console.log("    lineItemFulfillmentStatus:", li.lineItemFulfillmentStatus);
          // Print any refund-related keys
          for (const key of Object.keys(li)) {
            if (key.toLowerCase().includes("refund") && key !== "refunds") {
              console.log(`    ${key}:`, JSON.stringify(li[key]));
            }
          }
        }
      }
      // Check order-level refund fields
      console.log("\npaymentSummary:", JSON.stringify(data.paymentSummary, null, 2));
    }
  } catch (e: any) {
    console.log("Fulfillment API error:", e.message);
  }

  // 2. Post-Order API - search for returns (uses IAF auth)
  console.log("\n\n=== 2. POST-ORDER API - RETURN SEARCH ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/post-order/v2/return/search?order_id=${orderId}`,
      {
        headers: {
          Authorization: `IAF ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );
    const data = await resp.json();
    if (data.errors) {
      console.log("Error:", JSON.stringify(data.errors, null, 2));
    } else {
      console.log("Total returns:", data.totalEntries ?? data.members?.length ?? 0);
      if (data.members) {
        for (const ret of data.members) {
          console.log(`\n  Return ID: ${ret.returnId}`);
          console.log("    state:", ret.currentType);
          console.log("    status:", ret.status);
          console.log("    creationDate:", ret.creationInfo?.creationDate);
          console.log("    returnQuantity:", ret.returnQuantity);
          console.log("    buyerTotalRefund:", JSON.stringify(ret.buyerTotalRefund, null, 2));
          console.log("    sellerTotalRefund:", JSON.stringify(ret.sellerTotalRefund, null, 2));
          if (ret.detail?.itemDetail) {
            console.log("    itemDetail:", JSON.stringify(ret.detail.itemDetail, null, 2));
          }
          if (ret.returnItem) {
            console.log("    returnItem:", JSON.stringify(ret.returnItem, null, 2));
          }
        }
      }
      // Print full raw response for analysis
      console.log("\n  Full response:", JSON.stringify(data, null, 2));
    }
  } catch (e: any) {
    console.log("Post-Order return search error:", e.message);
  }

  // 3. Post-Order API - search cancellations (uses IAF auth)
  console.log("\n\n=== 3. POST-ORDER API - CANCELLATION SEARCH ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/post-order/v2/cancellation/search?order_id=${orderId}`,
      {
        headers: {
          Authorization: `IAF ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );
    const data = await resp.json();
    if (data.errors) {
      console.log("Error:", JSON.stringify(data.errors, null, 2));
    } else {
      console.log("Total cancellations:", data.totalEntries ?? data.cancellations?.length ?? 0);
      console.log("Full response:", JSON.stringify(data, null, 2));
    }
  } catch (e: any) {
    console.log("Post-Order cancellation search error:", e.message);
  }

  // 4. Finances API - getTransactions (may have per-item refund transactions)
  console.log("\n\n=== 4. FINANCES API - TRANSACTIONS FOR ORDER ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/sell/finances/v1/transaction?filter=orderId:{${orderId}}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );
    const data = await resp.json();
    if (data.errors) {
      console.log("Error:", JSON.stringify(data.errors, null, 2));
    } else {
      console.log("Total transactions:", data.total);
      if (data.transactions) {
        for (const tx of data.transactions) {
          console.log(`\n  TransactionID: ${tx.transactionId}`);
          console.log("    type:", tx.transactionType);
          console.log("    status:", tx.transactionStatus);
          console.log("    amount:", JSON.stringify(tx.amount));
          console.log("    totalFeeBasisAmount:", JSON.stringify(tx.totalFeeBasisAmount));
          console.log("    orderLineItems:", JSON.stringify(tx.orderLineItems, null, 2));
          console.log("    references:", JSON.stringify(tx.references, null, 2));
          if (tx.transactionType === "REFUND" || tx.transactionType === "CREDIT") {
            console.log("    *** REFUND TRANSACTION FOUND ***");
            console.log("    Full record:", JSON.stringify(tx, null, 2));
          }
        }
      }
    }
  } catch (e: any) {
    console.log("Finances API error:", e.message);
  }
}

main().catch(console.error);
