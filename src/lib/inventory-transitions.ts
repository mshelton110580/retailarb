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

      // Check if unit is in bad condition (anything that isn't a known-good condition)
      const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
      const isBadCondition = !goodConditions.has(unit.condition_status?.toLowerCase() ?? "");

      // PRIORITY 1: Item physically shipped or delivered back to seller.
      // Bad-condition units are marked returned; good-condition units are reset
      // to on_hand (they were kept, not the ones sent back).
      if (ret.return_shipped_date || ret.return_delivered_date) {
        newState = isBadCondition ? "returned" : "on_hand";
      }
      // PRIORITY 2: Return is closed with no return tracking
      else if (isReturnClosed(ret)) {
        // Refunded but item was never shipped back — we kept it
        if (ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund) {
          // Bad condition → parts_repair, good condition → stays on_hand (no change)
          if (isBadCondition) {
            newState = "parts_repair";
          }
        }
        // Closed with no refund and no return tracking — leave state as-is (on_hand or parts_repair)
      }
      // PRIORITY 3: Open return, not yet shipped — we need to send it back
      else {
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
 * Full recompute of inventory states across all units.
 * Runs three passes in order:
 *   1. Return-based states — re-evaluates every return against its units
 *      (handles returned/on_hand/to_be_returned/parts_repair from return data)
 *   2. Orphan fix — units with no return but bad condition stuck at on_hand
 *      are moved to to_be_returned
 *
 * Returns counts of changes made in each pass.
 */
export async function recomputeAllInventoryStates(): Promise<{
  returnPass: number;
  orphanPass: number;
}> {
  // Pass 1: re-run full return evaluation (handles good→on_hand correction too)
  let returnPass = 0;

  const returns = await prisma.returns.findMany({
    where: { order_id: { not: null } },
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

  // Track which unit IDs are covered by a return (so Pass 2 skips them)
  const unitsWithReturn = new Set<string>();

  for (const ret of returns) {
    if (!ret.order_id) continue;

    const units = await prisma.received_units.findMany({
      where: {
        order_id: ret.order_id,
        item_id: ret.item_id || undefined
      },
      select: { id: true, inventory_state: true, condition_status: true }
    });

    const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

    for (const unit of units) {
      unitsWithReturn.add(unit.id);
      const isBadCondition = !goodConditions.has(unit.condition_status?.toLowerCase() ?? "");
      let newState: string | null = null;

      if (ret.return_shipped_date || ret.return_delivered_date) {
        newState = isBadCondition ? "returned" : "on_hand";
      } else if (isReturnClosed(ret)) {
        if (ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund) {
          newState = isBadCondition ? "parts_repair" : "on_hand";
        }
      } else {
        newState = "to_be_returned";
      }

      if (newState && unit.inventory_state !== newState) {
        await prisma.received_units.update({
          where: { id: unit.id },
          data: { inventory_state: newState }
        });
        returnPass++;
      }
    }
  }

  // Pass 2: orphan fix — bad-condition units with no return record stuck at on_hand
  const orphanUnits = await prisma.received_units.findMany({
    where: { inventory_state: "on_hand" },
    select: { id: true, condition_status: true }
  });

  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
  let orphanPass = 0;

  for (const unit of orphanUnits) {
    if (unitsWithReturn.has(unit.id)) continue; // already handled in Pass 1
    const isBadCondition = !goodConditions.has(unit.condition_status?.toLowerCase() ?? "");
    if (isBadCondition) {
      await prisma.received_units.update({
        where: { id: unit.id },
        data: { inventory_state: "to_be_returned" }
      });
      orphanPass++;
    }
  }

  return { returnPass, orphanPass };
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
