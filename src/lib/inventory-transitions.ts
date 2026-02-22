import { prisma } from "@/lib/db";

const CLOSED_STATES = ["CLOSED"];

/**
 * Check if a return is closed (matching inventory/returns page logic)
 */
function isReturnClosed(ret: {
  ebay_state: string | null;
  ebay_status: string | null;
}): boolean {
  if (ret.ebay_state && CLOSED_STATES.includes(ret.ebay_state)) return true;
  if (ret.ebay_status && CLOSED_STATES.includes(ret.ebay_status)) return true;
  if (ret.ebay_state === "REFUND_ISSUED" || ret.ebay_state === "RETURN_CLOSED") return true;
  if (ret.ebay_status === "REFUND_ISSUED" || ret.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") return true;
  return false;
}

/**
 * Update inventory states based on return status changes.
 * Called when returns are synced from eBay.
 *
 * State priority:
 *   returned       — item physically shipped/delivered back
 *   parts_repair   — closed return WITH refund, item kept (compensated, bad condition)
 *   to_be_returned — open return, or closed with no refund (needs action)
 */
export async function updateInventoryStatesFromReturns() {
  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

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

  for (const ret of returns) {
    if (!ret.order_id) continue;

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

      const goodConditions2 = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
      const isBadCondition = !goodConditions2.has(unit.condition_status?.toLowerCase() ?? "");

      // PRIORITY 1: Item physically shipped or delivered back to seller
      if (ret.return_shipped_date || ret.return_delivered_date) {
        newState = "returned";
      }
      // PRIORITY 2: Return is closed
      else if (isReturnClosed(ret)) {
        // Refunded but item was never shipped back — we kept it
        if (ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund) {
          // Bad condition → parts_repair, good condition → stays on_hand (no change)
          if (isBadCondition) {
            newState = "parts_repair";
          }
        }
        // Closed with no refund and no return tracking — still needs action
        else {
          newState = "to_be_returned";
        }
      }
      // PRIORITY 3: Open return, not yet shipped — we need to send it back
      else {
        newState = "to_be_returned";
      }

      if (newState && unit.inventory_state !== newState) {
        await prisma.received_units.update({
          where: { id: unit.id },
          data: { inventory_state: newState }
        });
        console.log(`[Inventory Transition] Unit ${unit.id}: ${unit.inventory_state} → ${newState} (return ${ret.id})`);
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
