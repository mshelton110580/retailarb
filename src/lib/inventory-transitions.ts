import { prisma } from "@/lib/db";

const CLOSED_STATES = ["CLOSED"];

/**
 * Check if a return is closed (matching inventory/returns page logic)
 */
function isReturnClosed(ret: {
  ebay_state: string | null;
  ebay_status: string | null;
}): boolean {
  // Check for CLOSED state or status
  if (ret.ebay_state && CLOSED_STATES.includes(ret.ebay_state)) {
    return true;
  }

  if (ret.ebay_status && CLOSED_STATES.includes(ret.ebay_status)) {
    return true;
  }

  // These states also indicate closure
  if (ret.ebay_state === "REFUND_ISSUED" || ret.ebay_state === "RETURN_CLOSED") {
    return true;
  }

  // Explicit refund statuses mean it's closed
  if (ret.ebay_status === "REFUND_ISSUED" || ret.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") {
    return true;
  }

  return false;
}

/**
 * Update inventory states based on return status changes.
 * Called when returns are synced from eBay.
 */
export async function updateInventoryStatesFromReturns() {
  // Get all returns with their associated received units
  const returns = await prisma.returns.findMany({
    where: {
      order_id: { not: null }
    },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_state: true,
      ebay_status: true,
      ebay_type: true,
      return_shipped_date: true,
      return_delivered_date: true,
      refund_issued_date: true,
      actual_refund: true,
      refund_amount: true,
      estimated_refund: true
    }
  });

  for (const ret of returns) {
    if (!ret.order_id) continue;

    // Find all received units for this order and item
    const units = await prisma.received_units.findMany({
      where: {
        order_id: ret.order_id,
        item_id: ret.item_id || undefined
      },
      select: {
        id: true,
        inventory_state: true,
        condition_status: true
      }
    });

    for (const unit of units) {
      let newState: string | null = null;

      // Check if unit is in bad condition
      const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];
      const isBadCondition = badConditions.includes(unit.condition_status);

      // PRIORITY 1: Check if return is closed
      if (isReturnClosed(ret)) {
        // Return is closed - determine if it was returned or just refunded

        // If the item was physically returned (has return tracking)
        if (ret.return_delivered_date || ret.return_shipped_date) {
          newState = "returned";
        }
        // If refunded without return (no return tracking)
        else if (ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund) {
          // Only bad condition units go to parts_repair, good units stay on_hand
          if (isBadCondition) {
            newState = "parts_repair";
          }
          // Don't change state for good condition units - they stay on_hand
        }
        // Closed but no clear indication - assume returned
        else {
          newState = "returned";
        }
      }
      // PRIORITY 2: Refund issued without return being shipped - parts/keep
      else if ((ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund) && !ret.return_shipped_date && !ret.return_delivered_date) {
        // Only bad condition units go to parts_repair, good units stay on_hand
        if (isBadCondition) {
          newState = "parts_repair";
        }
      }
      // PRIORITY 3: Return is open but shipped
      else if (ret.return_shipped_date) {
        newState = "to_be_returned";
      }
      // PRIORITY 4: Return is open and waiting
      else if (ret.ebay_state === "RETURN_OPEN" || ret.ebay_status === "WAITING_FOR_SHIPPING_LABEL") {
        newState = "to_be_returned";
      }

      // Only update if state has changed and we have a valid new state
      if (newState && unit.inventory_state !== newState) {
        await prisma.received_units.update({
          where: { id: unit.id },
          data: { inventory_state: newState }
        });
        console.log(`[Inventory Transition] Updated unit ${unit.id} from ${unit.inventory_state} to ${newState} (return ${ret.id})`);
      }
    }
  }
}

/**
 * Manually update inventory state for a specific unit.
 * Used when user manually marks item for return or changes condition.
 */
export async function updateUnitInventoryState(
  unitId: string,
  newState: "on_hand" | "to_be_returned" | "parts_repair" | "returned"
) {
  await prisma.received_units.update({
    where: { id: unitId },
    data: { inventory_state: newState }
  });
}
