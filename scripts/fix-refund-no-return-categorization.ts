/**
 * Fix inventory categorization for units with refunds but no return shipped
 * These should be in "parts_repair" not "to_be_returned"
 */

import { prisma } from "../src/lib/db";

async function main() {
  console.log("Finding units with refunds but no return shipped...");

  // Get all returns with refunds but no shipping
  const returns = await prisma.returns.findMany({
    where: {
      order_id: { not: null },
      actual_refund: { not: null },
      return_shipped_date: null,
      return_delivered_date: null
    },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      actual_refund: true,
      refund_issued_date: true,
      ebay_state: true,
      ebay_status: true
    }
  });

  console.log(`Found ${returns.length} returns with refunds but no shipping`);

  let updatedCount = 0;

  for (const ret of returns) {
    if (!ret.order_id) continue;

    // Find all received units for this order/item
    const units = await prisma.received_units.findMany({
      where: {
        order_id: ret.order_id,
        item_id: ret.item_id || undefined,
        inventory_state: "to_be_returned" // Only update if currently marked as to_be_returned
      }
    });

    for (const unit of units) {
      await prisma.received_units.update({
        where: { id: unit.id },
        data: { inventory_state: "parts_repair" }
      });

      console.log(`Updated unit ${unit.id} (order ${ret.order_id}) from to_be_returned → parts_repair`);
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
