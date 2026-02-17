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

  // 3. Determine what the state should be
  console.log("=== Recommended Fixes ===\n");

  for (const ret of returns) {
    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    const matchingUnits = units.filter(u => u.item_id === itemId);

    let recommendedState = "unknown";

    // Check if return was delivered
    if (ret.return_delivered_date || ret.return_shipped_date) {
      recommendedState = "returned";
    }
    // Refund issued but not returned
    else if ((ret.refund_issued_date || ret.actual_refund) && !ret.return_shipped_date && !ret.return_delivered_date) {
      recommendedState = "parts_repair";
    }
    // Return open but not shipped
    else if (ret.ebay_state === "RETURN_OPEN" || ret.ebay_status === "WAITING_FOR_SHIPPING_LABEL") {
      recommendedState = "to_be_returned";
    }

    console.log(`Item ${itemId}:`);
    console.log(`  Recommended state: ${recommendedState}`);
    console.log(`  Matching units: ${matchingUnits.length}`);

    for (const unit of matchingUnits) {
      if (unit.inventory_state !== recommendedState) {
        console.log(`    ❌ Unit #${unit.unit_index}: ${unit.inventory_state} → should be ${recommendedState}`);
      } else {
        console.log(`    ✅ Unit #${unit.unit_index}: ${unit.inventory_state} (correct)`);
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

      let recommendedState: "on_hand" | "to_be_returned" | "parts_repair" | "returned" | null = null;

      if (ret.return_delivered_date || ret.return_shipped_date) {
        recommendedState = "returned";
      } else if ((ret.refund_issued_date || ret.actual_refund) && !ret.return_shipped_date && !ret.return_delivered_date) {
        recommendedState = "parts_repair";
      } else if (ret.ebay_state === "RETURN_OPEN" || ret.ebay_status === "WAITING_FOR_SHIPPING_LABEL") {
        recommendedState = "to_be_returned";
      }

      if (recommendedState) {
        for (const unit of matchingUnits) {
          if (unit.inventory_state !== recommendedState) {
            await prisma.received_units.update({
              where: { id: unit.id },
              data: { inventory_state: recommendedState }
            });
            console.log(`✅ Fixed unit #${unit.unit_index}: ${unit.inventory_state} → ${recommendedState}`);
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
