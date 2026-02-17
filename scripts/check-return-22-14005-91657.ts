import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "22-14005-91657";

  const ret = await prisma.returns.findFirst({
    where: { order_id: orderId },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      return_shipped_date: true,
      return_delivered_date: true,
      refund_issued_date: true,
      actual_refund: true,
      refund_amount: true,
      estimated_refund: true,
      ebay_state: true,
      ebay_status: true,
    }
  });

  console.log("Return record for order 22-14005-91657:");
  console.log(JSON.stringify(ret, null, 2));

  const units = await prisma.received_units.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true,
    },
    orderBy: { unit_index: 'asc' }
  });

  console.log("\nUnits:");
  for (const unit of units) {
    console.log(`  Unit ${unit.unit_index}: ${unit.condition_status} → ${unit.inventory_state}`);
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
