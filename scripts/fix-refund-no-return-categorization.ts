/**
 * Fix inventory categorization for units with refunds but no return shipped
 * These should be in "parts_repair" not "to_be_returned"
 */

import { prisma } from "../src/lib/db";

async function main() {
  console.log("Finding units with refunds but no return shipped...");

  // Get all returns with estimated_refund (original total) where no return was shipped
  // We'll calculate actual refund as: estimated_refund - current_order_total
  const returns = await prisma.returns.findMany({
    where: {
      order_id: { not: null },
      estimated_refund: { not: null },
      return_shipped_date: null,
      return_delivered_date: null
    },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      estimated_refund: true,
      refund_issued_date: true,
      ebay_state: true,
      ebay_status: true,
      order: {
        select: {
          order_items: {
            select: {
              item_id: true,
              transaction_price: true,
              shipping_cost: true
            }
          }
        }
      }
    }
  });

  console.log(`Found ${returns.length} returns with refunds but no shipping`);

  let updatedCount = 0;

  for (const ret of returns) {
    if (!ret.order_id || !ret.order?.order_items) continue;

    // Use item_id if available, otherwise use ebay_item_id
    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    // Calculate actual refund: estimated_refund - current_order_total
    const estimatedRefund = Number(ret.estimated_refund);
    const currentItemTotal = ret.order.order_items.reduce((sum, item) => {
      if (item.item_id === itemId) {
        return sum + Number(item.transaction_price) + Number(item.shipping_cost || 0);
      }
      return sum;
    }, 0);

    const calculatedRefund = estimatedRefund > currentItemTotal ? estimatedRefund - currentItemTotal : 0;

    // Only process if there's actually a refund
    if (calculatedRefund <= 0) continue;

    console.log(`Order ${ret.order_id}, Item ${itemId}: Refund = $${calculatedRefund.toFixed(2)} (estimated: $${estimatedRefund}, current: $${currentItemTotal.toFixed(2)})`);

    // Find all received units for this order/item that are bad condition
    const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];
    const units = await prisma.received_units.findMany({
      where: {
        order_id: ret.order_id,
        item_id: itemId,
        condition_status: { in: badConditions },
        inventory_state: "to_be_returned" // Only update if currently marked as to_be_returned
      }
    });

    for (const unit of units) {
      await prisma.received_units.update({
        where: { id: unit.id },
        data: { inventory_state: "parts_repair" }
      });

      console.log(`  Updated unit ${unit.id} (${unit.condition_status}) from to_be_returned → parts_repair`);
      updatedCount++;
    }
  }

  console.log(`\nFixed ${updatedCount} units`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
