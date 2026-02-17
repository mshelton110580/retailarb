/**
 * Debug why refund distribution logic isn't triggering
 */

import { prisma } from "../src/lib/db";

async function main() {
  const orderId = "22-14005-91657";

  // Get a single unit to test
  const unit = await prisma.received_units.findFirst({
    where: {
      order_id: orderId,
      category_id: { not: null },
    },
    select: {
      id: true,
      unit_index: true,
      condition_status: true,
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
  });

  if (!unit) {
    console.log("No unit found");
    return;
  }

  // Get return info
  const ret = await prisma.returns.findFirst({
    where: { order_id: orderId },
    select: {
      estimated_refund: true,
      order: {
        select: {
          order_items: {
            select: {
              item_id: true,
              transaction_price: true,
              shipping_cost: true,
            },
          },
        },
      },
    },
  });

  const itemId = unit.order_item.item_id;
  const estimatedRefund = Number(ret?.estimated_refund || 0);

  const currentItemTotal = ret?.order?.order_items.reduce((sum, item) => {
    if (item.item_id === itemId) {
      return sum + Number(item.transaction_price) + Number(item.shipping_cost || 0);
    }
    return sum;
  }, 0) || 0;

  const refundAmount = estimatedRefund > currentItemTotal ? estimatedRefund - currentItemTotal : 0;
  const totalCost = estimatedRefund; // From originalCostMap

  // Count units
  const orderItemUnitCounts = new Map<string, number>();
  const orderItemBadUnits = new Map<string, Set<string>>();
  const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];

  const units = await prisma.received_units.findMany({
    where: {
      order_id: orderId,
      category_id: { not: null },
    },
    select: {
      id: true,
      order_item_id: true,
      condition_status: true,
    },
  });

  for (const u of units) {
    if (u.order_item_id) {
      const count = orderItemUnitCounts.get(u.order_item_id) || 0;
      orderItemUnitCounts.set(u.order_item_id, count + 1);

      if (badConditions.includes(u.condition_status)) {
        if (!orderItemBadUnits.has(u.order_item_id)) {
          orderItemBadUnits.set(u.order_item_id, new Set());
        }
        orderItemBadUnits.get(u.order_item_id)!.add(u.id);
      }
    }
  }

  const unitsScanned = orderItemUnitCounts.get(unit.order_item.id) || 1;
  const badUnitsSet = orderItemBadUnits.get(unit.order_item.id);
  const badUnitsCount = badUnitsSet ? badUnitsSet.size : 0;

  console.log("=== Variables ===");
  console.log(`refundAmount: ${refundAmount}`);
  console.log(`totalCost: ${totalCost}`);
  console.log(`unitsScanned: ${unitsScanned}`);
  console.log(`badUnitsCount: ${badUnitsCount}`);
  console.log();

  console.log("=== Condition Check ===");
  console.log(`refundAmount > 0: ${refundAmount > 0} (${refundAmount} > 0)`);
  console.log(`refundAmount < totalCost: ${refundAmount < totalCost} (${refundAmount} < ${totalCost})`);
  console.log(`unitsScanned > 1: ${unitsScanned > 1} (${unitsScanned} > 1)`);
  console.log();

  const shouldEnterSmartLogic = refundAmount > 0 && refundAmount < totalCost && unitsScanned > 1;
  console.log(`Should enter smart refund logic: ${shouldEnterSmartLogic}`);
  console.log();

  if (shouldEnterSmartLogic) {
    console.log("=== Smart Refund Calculation ===");
    const perUnitCost = totalCost / unitsScanned;
    console.log(`Per-unit cost: $${perUnitCost.toFixed(2)}`);

    if (badUnitsCount === 0) {
      const itemCost = (totalCost - refundAmount) / unitsScanned;
      console.log(`All units good - item cost: $${itemCost.toFixed(2)}`);
    } else {
      const badUnitsTotalCost = perUnitCost * badUnitsCount;
      const goodUnitsCount = unitsScanned - badUnitsCount;
      console.log(`Bad units total cost: $${badUnitsTotalCost.toFixed(2)}`);
      console.log(`Good units count: ${goodUnitsCount}`);

      if (refundAmount <= badUnitsTotalCost) {
        console.log("Branch: Refund <= bad units cost");
        const refundPerBadUnit = refundAmount / badUnitsCount;
        const badUnitCost = Math.max(0, perUnitCost - refundPerBadUnit);
        console.log(`  Bad unit cost: $${badUnitCost.toFixed(2)}`);
        console.log(`  Good unit cost: $${perUnitCost.toFixed(2)}`);
      } else {
        console.log("Branch: Refund > bad units cost");
        const remainingRefund = refundAmount - badUnitsTotalCost;
        const refundPerGoodUnit = remainingRefund / goodUnitsCount;
        const goodUnitCost = Math.max(0, perUnitCost - refundPerGoodUnit);
        console.log(`  Bad unit cost: $0`);
        console.log(`  Good unit cost: $${goodUnitCost.toFixed(2)}`);
      }
    }
  } else {
    console.log("=== Fallback Calculation ===");
    const costAfterRefund = Math.max(0, totalCost - refundAmount);
    const itemCost = costAfterRefund / unitsScanned;
    console.log(`Cost after refund: $${costAfterRefund.toFixed(2)}`);
    console.log(`Item cost: $${itemCost.toFixed(2)}`);
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
