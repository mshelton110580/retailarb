/**
 * Debug originalCostMap population and retrieval
 */

import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "22-14005-91657";

  // Simulate the returns processing
  const returns = await prisma.returns.findMany({
    where: {
      order_id: orderId,
    },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      estimated_refund: true,
      order: {
        select: {
          order_items: {
            select: {
              id: true,
              item_id: true,
              transaction_price: true,
              shipping_cost: true,
            },
          },
        },
      },
    },
  });

  console.log("=== Processing Returns ===\n");
  const originalCostMap = new Map<string, number>();

  for (const ret of returns) {
    if (!ret.order_id) continue;

    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    const key = `${ret.order_id}-${itemId}`;
    console.log(`Processing return:`);
    console.log(`  ret.item_id: ${ret.item_id || "NULL"}`);
    console.log(`  ret.ebay_item_id: ${ret.ebay_item_id || "NULL"}`);
    console.log(`  itemId (used): ${itemId}`);
    console.log(`  Key: ${key}`);

    if (ret.estimated_refund && ret.order?.order_items) {
      const estimatedRefund = Number(ret.estimated_refund);
      console.log(`  estimated_refund: $${estimatedRefund}`);

      const currentItemTotal = ret.order.order_items.reduce((sum, item) => {
        if (item.item_id === itemId) {
          const total = sum + Number(item.transaction_price) + Number(item.shipping_cost || 0);
          console.log(`  Matched order_item: ${item.item_id}, price: ${item.transaction_price}, shipping: ${item.shipping_cost || 0}`);
          return total;
        }
        return sum;
      }, 0);

      console.log(`  Current item total: $${currentItemTotal}`);
      console.log(`  Setting originalCostMap["${key}"] = ${estimatedRefund}`);
      originalCostMap.set(key, estimatedRefund);
    }
    console.log();
  }

  // Now simulate unit processing
  console.log("=== Processing Units ===\n");

  const units = await prisma.received_units.findMany({
    where: {
      order_id: orderId,
      category_id: { not: null },
    },
    select: {
      id: true,
      unit_index: true,
      order_id: true,
      order_item_id: true,
      order: {
        select: {
          order_id: true,
        },
      },
      order_item: {
        select: {
          id: true,
          item_id: true,
          transaction_price: true,
          shipping_cost: true,
        },
      },
    },
    orderBy: { unit_index: "asc" },
    take: 3, // Just check first 3
  });

  for (const unit of units) {
    console.log(`Unit #${unit.unit_index}:`);
    console.log(`  unit.order?.order_id: ${unit.order?.order_id || "NULL"}`);
    console.log(`  unit.order_item.item_id: ${unit.order_item?.item_id || "NULL"}`);

    const refundKey = unit.order?.order_id && unit.order_item?.item_id
      ? `${unit.order.order_id}-${unit.order_item.item_id}`
      : null;

    console.log(`  Constructed refundKey: ${refundKey || "NULL"}`);

    if (refundKey && originalCostMap.has(refundKey)) {
      const totalCost = originalCostMap.get(refundKey)!;
      console.log(`  ✓ Found in originalCostMap: $${totalCost}`);
    } else {
      console.log(`  ✗ NOT found in originalCostMap`);
      console.log(`  Falling back to transaction_price + shipping`);
      const totalPrice = Number(unit.order_item?.transaction_price || 0);
      const totalShipping = Number(unit.order_item?.shipping_cost || 0);
      console.log(`  Fallback total: $${totalPrice + totalShipping}`);
    }
    console.log();
  }

  console.log("=== Map Contents ===");
  console.log("originalCostMap entries:");
  for (const [key, value] of originalCostMap.entries()) {
    console.log(`  "${key}" => $${value}`);
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
