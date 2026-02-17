import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "06-14029-36812";

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
  console.log(`Total units: ${units.length}`);

  // Group by category
  const byCategory = new Map<string, number>();
  for (const unit of units) {
    const catName = unit.category?.category_name || 'UNCATEGORIZED';
    byCategory.set(catName, (byCategory.get(catName) || 0) + 1);
  }

  console.log("\n=== Units by Category ===");
  for (const [cat, count] of byCategory.entries()) {
    console.log(`  ${cat}: ${count} units`);
  }

  console.log("\n=== Individual Units ===");
  for (const unit of units) {
    console.log(`Unit ${unit.unit_index}: category=${unit.category?.category_name || 'NULL'}, condition=${unit.condition_status}, state=${unit.inventory_state}`);
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
  if (returns.length > 0) {
    console.log(JSON.stringify(returns, null, 2));
  } else {
    console.log("No returns found");
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
