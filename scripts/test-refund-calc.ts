/**
 * Test refund calculation for order 22-14005-91657
 */

import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "22-14005-91657";

  // Get the return
  const ret = await prisma.returns.findFirst({
    where: { order_id: orderId },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      refund_amount: true,
      actual_refund: true,
      estimated_refund: true,
      order: {
        select: {
          order_items: {
            select: {
              item_id: true,
              transaction_price: true,
              shipping_cost: true,
              qty: true
            }
          }
        }
      }
    }
  });

  if (!ret) {
    console.log("No return found");
    return;
  }

  console.log("Return data:");
  console.log(`  refund_amount: $${ret.refund_amount || 0}`);
  console.log(`  actual_refund: $${ret.actual_refund || 0}`);
  console.log(`  estimated_refund: $${ret.estimated_refund || 0}`);

  const itemId = ret.item_id || ret.ebay_item_id;
  console.log(`  item_id: ${itemId}`);

  // Calculate current order total for this item
  const currentItemTotal = ret.order?.order_items.reduce((sum, item) => {
    if (item.item_id === itemId) {
      console.log(`  Found matching order item: ${item.item_id}`);
      console.log(`    transaction_price: $${item.transaction_price}`);
      console.log(`    shipping_cost: $${item.shipping_cost || 0}`);
      console.log(`    qty: ${item.qty}`);
      return sum + Number(item.transaction_price) + Number(item.shipping_cost || 0);
    }
    return sum;
  }, 0) || 0;

  console.log(`\nCurrent item total: $${currentItemTotal}`);

  const estimatedRefund = Number(ret.estimated_refund || 0);
  const calculatedRefund = estimatedRefund > currentItemTotal ? estimatedRefund - currentItemTotal : 0;

  console.log(`Estimated refund: $${estimatedRefund}`);
  console.log(`Calculated refund: $${calculatedRefund.toFixed(2)}`);

  // Get units
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

  const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];
  const badUnits = units.filter(u => badConditions.includes(u.condition_status));

  console.log(`\nTotal units: ${units.length}`);
  console.log(`Bad units: ${badUnits.length}`);
  console.log(`Per-unit cost: $${(currentItemTotal / units.length).toFixed(2)}`);
  console.log(`Refund per bad unit: $${badUnits.length > 0 ? (calculatedRefund / badUnits.length).toFixed(2) : 0}`);
  console.log(`Cost per bad unit after refund: $${badUnits.length > 0 ? (currentItemTotal / units.length - calculatedRefund / badUnits.length).toFixed(2) : 0}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
