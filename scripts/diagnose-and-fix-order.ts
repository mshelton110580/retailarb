/**
 * Diagnose and fix specific order issues
 * Usage: npx tsx scripts/diagnose-and-fix-order.ts <order-id>
 */

import { prisma } from "../src/lib/db";

const orderId = process.argv[2];

if (!orderId) {
  console.error("Usage: npx tsx scripts/diagnose-and-fix-order.ts <order-id>");
  process.exit(1);
}

async function main() {
  console.log(`\n=== Diagnosing Order: ${orderId} ===\n`);

  // 1. Get the return information
  const returns = await prisma.returns.findMany({
    where: { order_id: orderId },
    select: {
      id: true,
      item_id: true,
      ebay_item_id: true,
      actual_refund: true,
      estimated_refund: true,
      return_shipped_date: true,
      return_delivered_date: true,
      refund_issued_date: true,
      ebay_state: true,
      ebay_status: true
    }
  });

  console.log(`Found ${returns.length} return(s):`);
  for (const ret of returns) {
    console.log(`  Return ID: ${ret.id}`);
    console.log(`    Item ID: ${ret.item_id || ret.ebay_item_id || "N/A"}`);
    console.log(`    Actual Refund: $${ret.actual_refund || 0}`);
    console.log(`    Estimated Refund: $${ret.estimated_refund || 0}`);
    console.log(`    Return Shipped: ${ret.return_shipped_date || "No"}`);
    console.log(`    Return Delivered: ${ret.return_delivered_date || "No"}`);
    console.log(`    Refund Issued: ${ret.refund_issued_date || "No"}`);
    console.log(`    eBay State: ${ret.ebay_state || "N/A"}`);
    console.log(`    eBay Status: ${ret.ebay_status || "N/A"}`);
    console.log();
  }

  // 2. Get received units for this order
  const units = await prisma.received_units.findMany({
    where: { order_id: orderId },
    orderBy: { unit_index: "asc" },
    select: {
      id: true,
      item_id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true,
      order_item: {
        select: {
          transaction_price: true,
          shipping_cost: true,
          qty: true
        }
      }
    }
  });

  console.log(`Found ${units.length} received unit(s):`);
  for (const unit of units) {
    console.log(`  Unit #${unit.unit_index} (ID: ${unit.id})`);
    console.log(`    Item ID: ${unit.item_id}`);
    console.log(`    Condition: ${unit.condition_status}`);
    console.log(`    Current State: ${unit.inventory_state}`);
    console.log();
  }

  // 3. Calculate order totals
  const orderTotal = units.reduce((sum, unit) => {
    if (!unit.order_item) return sum;
    const price = Number(unit.order_item.transaction_price);
    const shipping = Number(unit.order_item.shipping_cost) || 0;
    return sum + price + shipping;
  }, 0);

  console.log(`Order Total: $${orderTotal.toFixed(2)}\n`);

  // 4. Determine what the state should be
  console.log("=== Recommended Fixes ===\n");

  for (const ret of returns) {
    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    const matchingUnits = units.filter(u => u.item_id === itemId);

    // Check if there was a partial refund by comparing estimated_refund to order total
    const estimatedRefund = Number(ret.estimated_refund) || 0;
    const actualRefund = Number(ret.actual_refund) || 0;
    const hasPartialRefund = estimatedRefund > 0 && estimatedRefund < orderTotal;
    const hasRefund = actualRefund > 0 || hasPartialRefund;

    let recommendedState = "unknown";

    // Check if return was delivered
    if (ret.return_delivered_date || ret.return_shipped_date) {
      recommendedState = "returned";
    }
    // Refund issued but not returned (check both actual_refund and estimated_refund)
    else if (hasRefund && !ret.return_shipped_date && !ret.return_delivered_date) {
      recommendedState = "parts_repair";
    }
    // Return open but not shipped
    else if (ret.ebay_state === "RETURN_OPEN" || ret.ebay_status === "WAITING_FOR_SHIPPING_LABEL") {
      recommendedState = "to_be_returned";
    }

    console.log(`Item ${itemId}:`);
    if (hasPartialRefund) {
      console.log(`  ⚠️  Partial refund detected: Order total $${orderTotal.toFixed(2)}, Estimated refund $${estimatedRefund.toFixed(2)}`);
    }

    console.log(`Item ${itemId}:`);
    console.log(`  Recommended state: ${recommendedState} (for bad units)`);
    console.log(`  Good units should stay: on_hand`);
    console.log(`  Matching units: ${matchingUnits.length}`);

    const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];

    for (const unit of matchingUnits) {
      const isBadUnit = badConditions.includes(unit.condition_status);
      const correctState = isBadUnit ? recommendedState : "on_hand";

      if (unit.inventory_state !== correctState) {
        console.log(`    ❌ Unit #${unit.unit_index} (${unit.condition_status}): ${unit.inventory_state} → should be ${correctState}`);
      } else {
        console.log(`    ✅ Unit #${unit.unit_index} (${unit.condition_status}): ${unit.inventory_state} (correct)`);
      }
    }
    console.log();
  }

  // 4. Ask for confirmation to fix
  console.log("\n=== Apply Fixes? ===");
  console.log("Run with --fix flag to apply these changes");

  if (process.argv.includes("--fix")) {
    let fixCount = 0;

    for (const ret of returns) {
      const itemId = ret.item_id || ret.ebay_item_id;
      if (!itemId) continue;

      const matchingUnits = units.filter(u => u.item_id === itemId);

      // Check for refund (actual or partial via estimated_refund)
      const estimatedRefund = Number(ret.estimated_refund) || 0;
      const actualRefund = Number(ret.actual_refund) || 0;
      const hasPartialRefund = estimatedRefund > 0 && estimatedRefund < orderTotal;
      const hasRefund = actualRefund > 0 || hasPartialRefund;

      let recommendedState: "on_hand" | "to_be_returned" | "parts_repair" | "returned" | null = null;

      if (ret.return_delivered_date || ret.return_shipped_date) {
        recommendedState = "returned";
      } else if (hasRefund && !ret.return_shipped_date && !ret.return_delivered_date) {
        recommendedState = "parts_repair";
      } else if (ret.ebay_state === "RETURN_OPEN" || ret.ebay_status === "WAITING_FOR_SHIPPING_LABEL") {
        recommendedState = "to_be_returned";
      }

      if (recommendedState) {
        const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];

        for (const unit of matchingUnits) {
          // Only bad units should go to parts_repair/returned/to_be_returned
          // Good units should stay on_hand (unless they were physically returned)
          const isBadUnit = badConditions.includes(unit.condition_status);
          const correctState = isBadUnit ? recommendedState : "on_hand";

          if (unit.inventory_state !== correctState) {
            await prisma.received_units.update({
              where: { id: unit.id },
              data: { inventory_state: correctState }
            });
            console.log(`✅ Fixed unit #${unit.unit_index} (${unit.condition_status}): ${unit.inventory_state} → ${correctState}`);
            fixCount++;
          }
        }
      }
    }

    console.log(`\n✅ Fixed ${fixCount} units`);
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
