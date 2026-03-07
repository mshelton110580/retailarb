import { getValidAccessToken } from "../src/lib/ebay/token";

const accountId = "cmll8dvd90001prri3d0mvn6k";
const orderId = "02-14164-85361";

async function main() {
  const { token } = await getValidAccessToken(accountId);

  // 1. Post-Order API - Inquiry search (INR cases can have refunds)
  console.log("=== 1. POST-ORDER API - INQUIRY SEARCH ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/post-order/v2/inquiry/search?order_id=${orderId}`,
      {
        headers: {
          Authorization: `IAF ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      console.log("Full response:", JSON.stringify(data, null, 2));
    } catch {
      console.log("Raw response:", text);
    }
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // 2. Post-Order API - Case search
  console.log("\n\n=== 2. POST-ORDER API - CASE SEARCH ===");
  try {
    const resp = await fetch(
      `https://api.ebay.com/post-order/v2/casemanagement/search?order_id=${orderId}`,
      {
        headers: {
          Authorization: `IAF ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      console.log("Full response:", JSON.stringify(data, null, 2));
    } catch {
      console.log("Raw response:", text);
    }
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // 3. Trading API - GetOrderTransactions (may have more detail)
  console.log("\n\n=== 3. TRADING API - GetOrderTransactions ===");
  try {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetOrderTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <OrderIDArray>
        <OrderID>${orderId}</OrderID>
      </OrderIDArray>
      <DetailLevel>ReturnAll</DetailLevel>
      <IncludeFinalValueFees>true</IncludeFinalValueFees>
    </GetOrderTransactionsRequest>`;

    const resp = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetOrderTransactions",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1415",
        "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID ?? "",
        "X-EBAY-API-IAF-TOKEN": token
      },
      body
    });

    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      allowBooleanAttributes: true,
      parseTagValue: false,
      parseAttributeValue: false
    });
    const xml = await resp.text();
    const data = parser.parse(xml);
    const orderList = data?.GetOrderTransactionsResponse?.OrderArray?.Order;
    if (orderList) {
      const order = Array.isArray(orderList) ? orderList[0] : orderList;
      console.log("MonetaryDetails:", JSON.stringify(order.MonetaryDetails, null, 2));

      const txns = Array.isArray(order.TransactionArray?.Transaction)
        ? order.TransactionArray.Transaction
        : [order.TransactionArray?.Transaction].filter(Boolean);

      for (const tx of txns) {
        console.log(`\nTransaction ItemID: ${tx?.Item?.ItemID}`);
        console.log("  MonetaryDetails:", JSON.stringify(tx?.MonetaryDetails, null, 2));
        console.log("  RefundArray:", JSON.stringify(tx?.RefundArray, null, 2));
        console.log("  ExternalTransaction:", JSON.stringify(tx?.ExternalTransaction, null, 2));
        console.log("  FinalValueFee:", JSON.stringify(tx?.FinalValueFee));
        console.log("  TransactionPrice:", JSON.stringify(tx?.TransactionPrice));
        // Dump all keys to find anything refund-related
        const refundKeys = Object.keys(tx || {}).filter(k =>
          k.toLowerCase().includes("refund") ||
          k.toLowerCase().includes("monetary") ||
          k.toLowerCase().includes("adjustment") ||
          k.toLowerCase().includes("dispute")
        );
        if (refundKeys.length) {
          console.log("  Refund-related keys found:", refundKeys);
          for (const k of refundKeys) {
            console.log(`    ${k}:`, JSON.stringify(tx[k], null, 2));
          }
        }
      }
    } else {
      console.log("No order data returned");
      console.log("Ack:", data?.GetOrderTransactionsResponse?.Ack);
      console.log("Errors:", JSON.stringify(data?.GetOrderTransactionsResponse?.Errors, null, 2));
    }
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  // 4. Trading API - GetItemTransactions for the specific item
  console.log("\n\n=== 4. TRADING API - GetItemTransactions (item 236573070455) ===");
  try {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <ItemID>236573070455</ItemID>
      <DetailLevel>ReturnAll</DetailLevel>
      <IncludeFinalValueFees>true</IncludeFinalValueFees>
    </GetItemTransactionsRequest>`;

    const resp = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetItemTransactions",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1415",
        "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID ?? "",
        "X-EBAY-API-IAF-TOKEN": token
      },
      body
    });

    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      allowBooleanAttributes: true,
      parseTagValue: false,
      parseAttributeValue: false
    });
    const xml = await resp.text();
    const data = parser.parse(xml);

    const ack = data?.GetItemTransactionsResponse?.Ack;
    console.log("Ack:", ack);

    if (ack === "Failure") {
      console.log("Error:", JSON.stringify(data?.GetItemTransactionsResponse?.Errors, null, 2));
    } else {
      const txns = data?.GetItemTransactionsResponse?.TransactionArray?.Transaction;
      const txList = Array.isArray(txns) ? txns : [txns].filter(Boolean);
      for (const tx of txList) {
        console.log("\nTransactionID:", tx?.TransactionID);
        console.log("  MonetaryDetails:", JSON.stringify(tx?.MonetaryDetails, null, 2));
        console.log("  RefundArray:", JSON.stringify(tx?.RefundArray, null, 2));
        console.log("  ExternalTransaction:", JSON.stringify(tx?.ExternalTransaction, null, 2));
        console.log("  TransactionPrice:", JSON.stringify(tx?.TransactionPrice));
      }
    }
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}

main().catch(console.error);
