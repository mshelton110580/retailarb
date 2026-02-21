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

/** Check if an INR/case is in a non-open (resolved/closed) state */
function isInrClosed(inr: { ebay_status: string | null; ebay_state: string | null }): boolean {
  const s = (inr.ebay_status ?? inr.ebay_state ?? "").toUpperCase();
  // Open/active states — still needs action
  const OPEN_STATES = ["OPEN", "IN_PROGRESS", "WAITING_BUYER_RESPONSE", "WAITING_SELLER_RESPONSE", "CS_REVIEW"];
  if (OPEN_STATES.some(o => s.includes(o))) return false;
  // Anything non-empty and not open is considered closed
  return s.length > 0;
}

/**
 * Update inventory states based on return and INR status changes.
 * Called when returns/INRs are synced from eBay.
 *
 * State priority:
 *   returned           — item physically shipped/delivered back
 *   parts_repair       — closed return WITH refund, item kept (compensated)
 *   possible_chargeback — closed return with NO refund and NO tracking back
 *                         OR closed INR where order was NOT delivered
 *   to_be_returned     — open return or open INR (needs action)
 */
export async function updateInventoryStatesFromReturns() {
  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

  // ── STEP 1: Process returns ──────────────────────────────────────────────
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
      where: { order_id: ret.order_id, item_id: ret.item_id || undefined },
      select: { id: true, inventory_state: true, condition_status: true }
    });

    for (const unit of units) {
      let newState: string | null = null;
      const isBadCondition = !goodConditions.has(unit.condition_status?.toLowerCase() ?? "");
      const hasRefund = !!(ret.refund_issued_date || ret.actual_refund || ret.refund_amount || ret.estimated_refund);

      if (ret.return_shipped_date || ret.return_delivered_date) {
        // Item physically shipped/delivered back
        newState = "returned";
      } else if (isReturnClosed(ret)) {
        if (hasRefund) {
          // Got a refund, kept the item — compensated
          if (isBadCondition) newState = "parts_repair";
          // Good condition + refund: stays on_hand (no change needed)
        } else {
          // Closed with NO refund and NO return tracking — possible chargeback
          newState = "possible_chargeback";
        }
      } else {
        // Open return — needs to be sent back
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

  // ── STEP 2: Process INR cases ────────────────────────────────────────────
  const inrCases = await prisma.inr_cases.findMany({
    where: { order_id: { not: null } },
    select: {
      id: true,
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      ebay_status: true,
      ebay_state: true,
    }
  });

  for (const inr of inrCases) {
    if (!inr.order_id) continue;

    // Look up whether the shipment was delivered
    const shipment = await prisma.shipments.findFirst({
      where: { order_id: inr.order_id },
      select: { delivered_at: true }
    });
    const wasDelivered = !!shipment?.delivered_at;

    // Resolve item_id: prefer item_id column, fall back to ebay_item_id
    const itemId = inr.item_id ?? inr.ebay_item_id ?? undefined;

    const units = await prisma.received_units.findMany({
      where: { order_id: inr.order_id, ...(itemId ? { item_id: itemId } : {}) },
      select: { id: true, inventory_state: true }
    });

    for (const unit of units) {
      // Skip units already set by a return (returns take priority over INRs)
      if (["returned", "parts_repair"].includes(unit.inventory_state)) continue;

      let newState: string | null = null;

      if (isInrClosed(inr)) {
        if (wasDelivered) {
          // INR closed because item was actually delivered — no action needed
          // Don't override whatever state the unit is in
        } else {
          // INR closed, order not delivered — suspicious, possible chargeback
          newState = "possible_chargeback";
        }
      } else if (inr.ebay_status || inr.ebay_state) {
        // Active/open INR — needs action
        newState = "to_be_returned";
      }

      if (newState && unit.inventory_state !== newState) {
        await prisma.received_units.update({
          where: { id: unit.id },
          data: { inventory_state: newState }
        });
        console.log(`[Inventory Transition] Unit ${unit.id}: ${unit.inventory_state} → ${newState} (INR ${inr.id})`);
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
