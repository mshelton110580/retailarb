import { getValidAccessToken } from "../src/lib/ebay/token";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false
});

async function main() {
  const accountId = "cmll8dvd90001prri3d0mvn6k";
  const orderId = "02-14164-85361";
  const targetItemId = "236573070455";

  const { token } = await getValidAccessToken(accountId);

  // Pull the specific order with full detail
  const body = `<?xml version="1.0" encoding="utf-8"?>
  <GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <OrderIDArray>
      <OrderID>${orderId}</OrderID>
    </OrderIDArray>
    <DetailLevel>ReturnAll</DetailLevel>
  </GetOrdersRequest>`;

  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetOrders",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1415",
      "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID ?? "",
      "X-EBAY-API-IAF-TOKEN": token
    },
    body
  });

  const xml = await response.text();
  const data = parser.parse(xml);

  const order = data?.GetOrdersResponse?.OrderArray?.Order;
  if (!order) {
    console.log("Order not found");
    return;
  }

  // Print order-level financial fields
  console.log("=== ORDER LEVEL ===");
  console.log("OrderID:", order.OrderID);
  console.log("OrderStatus:", order.OrderStatus);
  console.log("Total:", JSON.stringify(order.Total));
  console.log("Subtotal:", JSON.stringify(order.Subtotal));
  console.log("AdjustmentAmount:", JSON.stringify(order.AdjustmentAmount));
  console.log("AmountPaid:", JSON.stringify(order.AmountPaid));
  console.log("AmountSaved:", JSON.stringify(order.AmountSaved));

  // Print all monetary refund-related fields at order level
  console.log("\n=== ORDER MONETARY REFUND FIELDS ===");
  console.log("MonetaryDetails:", JSON.stringify(order.MonetaryDetails, null, 2));

  // Print each transaction
  const txns = Array.isArray(order.TransactionArray?.Transaction)
    ? order.TransactionArray.Transaction
    : [order.TransactionArray?.Transaction].filter(Boolean);

  for (const tx of txns) {
    const itemId = tx?.Item?.ItemID;
    console.log(`\n=== TRANSACTION: Item ${itemId} ${itemId === targetItemId ? "(TARGET)" : ""} ===`);
    console.log("Title:", tx?.Item?.Title);
    console.log("QuantityPurchased:", tx?.QuantityPurchased);
    console.log("TransactionPrice:", JSON.stringify(tx?.TransactionPrice));
    console.log("ActualShippingCost:", JSON.stringify(tx?.ActualShippingCost));
    console.log("FinalValueFee:", JSON.stringify(tx?.FinalValueFee));
    console.log("OrderLineItemID:", tx?.OrderLineItemID);
    console.log("TransactionID:", tx?.TransactionID);

    // Refund-related fields
    console.log("RefundAmount:", JSON.stringify(tx?.RefundAmount));
    console.log("MonetaryDetails:", JSON.stringify(tx?.MonetaryDetails, null, 2));
    console.log("Taxes:", JSON.stringify(tx?.Taxes, null, 2));

    // Print any field containing "refund" (case insensitive)
    for (const key of Object.keys(tx || {})) {
      if (key.toLowerCase().includes("refund") || key.toLowerCase().includes("adjustment")) {
        console.log(`${key}:`, JSON.stringify(tx[key], null, 2));
      }
    }
  }
}

main().catch(console.error);
