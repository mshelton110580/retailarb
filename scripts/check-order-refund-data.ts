/**
 * Check refund data for a specific order
 * Usage: npx tsx scripts/check-order-refund-data.ts <order-id>
 */

import { prisma } from "../src/lib/db";

const orderId = process.argv[2];

if (!orderId) {
  console.error("Usage: npx tsx scripts/check-order-refund-data.ts <order-id>");
  process.exit(1);
}

async function main() {
  console.log(`\n=== Checking Order: ${orderId} ===\n`);

  // Get order items
  const orderItems = await prisma.order_items.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      item_id: true,
      title: true,
      qty: true,
      transaction_price: true,
      shipping_cost: true
    }
  });

  console.log("Order Items:");
  let orderTotal = 0;
  for (const item of orderItems) {
    const itemTotal = Number(item.transaction_price) + Number(item.shipping_cost || 0);
    orderTotal += itemTotal;
    console.log(`  ${item.item_id}`);
    console.log(`    Title: ${item.title}`);
    console.log(`    Qty: ${item.qty}`);
    console.log(`    Price: $${item.transaction_price}`);
    console.log(`    Shipping: $${item.shipping_cost || 0}`);
    console.log(`    Total: $${itemTotal.toFixed(2)}`);
  }
  console.log(`\nOrder Total from items: $${orderTotal.toFixed(2)}\n`);

  // Get returns
  const returns = await prisma.returns.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      item_id: true,
      ebay_item_id: true,
      refund_amount: true,
      actual_refund: true,
      estimated_refund: true,
      refund_issued_date: true,
      return_shipped_date: true,
      return_delivered_date: true,
      ebay_state: true,
      ebay_status: true
    }
  });

  console.log(`Returns (${returns.length}):`);
  for (const ret of returns) {
    console.log(`  Return ID: ${ret.id}`);
    console.log(`    Item ID: ${ret.item_id || ret.ebay_item_id || "N/A"}`);
    console.log(`    refund_amount: $${ret.refund_amount || 0}`);
    console.log(`    actual_refund: $${ret.actual_refund || 0}`);
    console.log(`    estimated_refund: $${ret.estimated_refund || 0}`);
    console.log(`    refund_issued_date: ${ret.refund_issued_date || "No"}`);
    console.log(`    return_shipped_date: ${ret.return_shipped_date || "No"}`);
    console.log(`    return_delivered_date: ${ret.return_delivered_date || "No"}`);
    console.log(`    eBay State: ${ret.ebay_state || "N/A"}`);
    console.log(`    eBay Status: ${ret.ebay_status || "N/A"}`);

    // Calculate what the refund should be
    if (ret.estimated_refund && Number(ret.estimated_refund) > 0) {
      const estimatedRefund = Number(ret.estimated_refund);
      console.log(`\n    Analysis:`);
      console.log(`      Original Total (estimated_refund): $${estimatedRefund.toFixed(2)}`);
      console.log(`      Current Order Total: $${orderTotal.toFixed(2)}`);
      console.log(`      Calculated Refund: $${(estimatedRefund - orderTotal).toFixed(2)}`);
    }
    console.log();
  }

  // Get received units
  const units = await prisma.received_units.findMany({
    where: { order_id: orderId },
    orderBy: { unit_index: "asc" },
    select: {
      id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true
    }
  });

  console.log(`Received Units (${units.length}):`);
  const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];
  let badCount = 0;
  for (const unit of units) {
    const isBad = badConditions.includes(unit.condition_status);
    if (isBad) badCount++;
    console.log(`  Unit #${unit.unit_index}: ${unit.condition_status} (${unit.inventory_state}) ${isBad ? "← BAD" : ""}`);
  }
  console.log(`\nBad units: ${badCount} / ${units.length}`);
  console.log(`Per-unit cost: $${(orderTotal / units.length).toFixed(2)}`);

  if (badCount > 0) {
    // Assume refund should be distributed among bad units
    console.log(`\nIf refund is distributed among bad units only:`);
    for (const ret of returns) {
      if (ret.refund_amount || ret.actual_refund || ret.estimated_refund) {
        const refund = Number(ret.refund_amount || ret.actual_refund || 0);
        if (refund > 0) {
          console.log(`  Refund per bad unit: $${(refund / badCount).toFixed(2)}`);
          console.log(`  Cost per bad unit after refund: $${(orderTotal / units.length - refund / badCount).toFixed(2)}`);
        } else if (ret.estimated_refund) {
          const calculatedRefund = Number(ret.estimated_refund) - orderTotal;
          if (calculatedRefund > 0) {
            console.log(`  Calculated refund: $${calculatedRefund.toFixed(2)}`);
            console.log(`  Refund per bad unit: $${(calculatedRefund / badCount).toFixed(2)}`);
            console.log(`  Cost per bad unit after refund: $${(orderTotal / units.length - calculatedRefund / badCount).toFixed(2)}`);
          }
        }
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
