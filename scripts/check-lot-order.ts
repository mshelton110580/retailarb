import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "9434608106245656129003";

  // Get order details
  const order = await prisma.orders.findUnique({
    where: { order_id: orderId },
    select: {
      order_id: true,
      totals: true,
      order_items: {
        select: {
          id: true,
          item_id: true,
          title: true,
          qty: true,
          transaction_price: true,
          shipping_cost: true
        }
      }
    }
  });

  console.log("=== Order Details ===");
  console.log(JSON.stringify(order, null, 2));

  // Get received units
  const units = await prisma.received_units.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      unit_index: true,
      item_id: true,
      condition_status: true,
      inventory_state: true,
      category_id: true,
      category: {
        select: {
          id: true,
          category_name: true,
          gtin: true
        }
      }
    },
    orderBy: { unit_index: 'asc' }
  });

  console.log("\n=== Received Units ===");
  for (const unit of units) {
    console.log(`Unit ${unit.unit_index}: item_id=${unit.item_id}, category=${unit.category?.category_name || 'NULL'}, condition=${unit.condition_status}, state=${unit.inventory_state}`);
  }

  // Check if there are any returns
  const returns = await prisma.returns.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      item_id: true,
      ebay_item_id: true,
      estimated_refund: true,
      refund_amount: true,
      return_shipped_date: true,
      ebay_state: true
    }
  });

  console.log("\n=== Returns ===");
  console.log(JSON.stringify(returns, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
