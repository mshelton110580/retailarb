/**
 * Debug bad units tracking for order 22-14005-91657
 */

import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "22-14005-91657";

  const units = await prisma.received_units.findMany({
    where: {
      order_id: orderId,
      category_id: { not: null }
    },
    select: {
      id: true,
      item_id: true,
      order_id: true,
      order_item_id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true,
      order_item: {
        select: {
          id: true,
          item_id: true,
          transaction_price: true,
          shipping_cost: true
        }
      }
    },
    orderBy: { unit_index: "asc" }
  });

  console.log(`Found ${units.length} units\n`);

  const orderItemUnitCounts = new Map<string, number>();
  const orderItemBadUnits = new Map<string, Set<string>>();
  const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];

  for (const unit of units) {
    console.log(`Unit #${unit.unit_index}:`);
    console.log(`  ID: ${unit.id}`);
    console.log(`  Condition: ${unit.condition_status}`);
    console.log(`  Inventory State: ${unit.inventory_state}`);
    console.log(`  order_item_id: ${unit.order_item_id || "NULL"}`);
    console.log(`  Is bad? ${badConditions.includes(unit.condition_status)}`);

    if (unit.order_item_id) {
      const count = orderItemUnitCounts.get(unit.order_item_id) || 0;
      orderItemUnitCounts.set(unit.order_item_id, count + 1);

      if (badConditions.includes(unit.condition_status)) {
        if (!orderItemBadUnits.has(unit.order_item_id)) {
          orderItemBadUnits.set(unit.order_item_id, new Set());
        }
        orderItemBadUnits.get(unit.order_item_id)!.add(unit.id);
        console.log(`  ✓ Added to bad units map`);
      }
    } else {
      console.log(`  ⚠️  NO order_item_id - will NOT be tracked!`);
    }
    console.log();
  }

  console.log("=== Summary ===");
  console.log(`Total units: ${units.length}`);
  console.log(`Units with order_item_id: ${Array.from(orderItemUnitCounts.values()).reduce((a,b) => a+b, 0)}`);

  for (const [orderItemId, count] of orderItemUnitCounts.entries()) {
    const badUnitsSet = orderItemBadUnits.get(orderItemId);
    const badCount = badUnitsSet ? badUnitsSet.size : 0;
    console.log(`\norder_item_id ${orderItemId}:`);
    console.log(`  Total units: ${count}`);
    console.log(`  Bad units: ${badCount}`);
    console.log(`  Good units: ${count - badCount}`);
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
