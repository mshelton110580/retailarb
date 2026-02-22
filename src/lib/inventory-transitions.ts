import { prisma } from "@/lib/db";

const CLOSED_STATES = ["CLOSED"];

/**
 * Determine if a refund was issued for an order by comparing original_total
 * (what was paid at purchase) to totals.total (current eBay balance).
 * A refund exists if the current total is less than the original total.
 */
function orderHasRefund(order: {
  original_total: any;
  totals: any;
}): boolean {
  const originalTotal = order.original_total != null ? Number(order.original_total) : null;
  const currentTotal = order.totals && typeof order.totals === "object" && "total" in order.totals
    ? Number((order.totals as any).total)
    : null;
  if (originalTotal === null || currentTotal === null) return false;
  return currentTotal < originalTotal;
}

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
      order: {
        select: { original_total: true, totals: true }
      }
    }
  });

  for (const ret of returns) {
    if (!ret.order_id) continue;

    const [units, shipment] = await Promise.all([
      prisma.received_units.findMany({
        where: { order_id: ret.order_id, item_id: ret.item_id || undefined },
        select: { id: true, inventory_state: true, condition_status: true }
      }),
      prisma.shipments.findFirst({
        where: { order_id: ret.order_id },
        select: { delivered_at: true }
      })
    ]);

    for (const unit of units) {
      let newState: string | null = null;
      const isBadCondition = !goodConditions.has(unit.condition_status?.toLowerCase() ?? "");
      // Refund determined by original_total vs current totals.total
      const hasRefund = ret.order ? orderHasRefund(ret.order) : false;
      // Order never delivered to us (outbound shipment status)
      const orderNeverDelivered = !shipment?.delivered_at;

      if (isReturnClosed(ret)) {
        if (hasRefund) {
          // Closed with refund — compensated, item kept
          if (isBadCondition) newState = "parts_repair";
          // Good condition + refund: stays on_hand (no state change)
        } else if (orderNeverDelivered) {
          // Closed, no refund, order never delivered to us — possible chargeback
          newState = "possible_chargeback";
        }
        // else: closed, no refund, but order was delivered — leave state unchanged
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

    // Look up shipment delivery status and order totals for refund check
    const [shipment, order] = await Promise.all([
      prisma.shipments.findFirst({
        where: { order_id: inr.order_id },
        select: { delivered_at: true }
      }),
      prisma.orders.findUnique({
        where: { order_id: inr.order_id },
        select: { original_total: true, totals: true }
      })
    ]);

    const wasDelivered = !!shipment?.delivered_at;
    // Refund determined by original_total vs current totals.total
    const hasRefund = order ? orderHasRefund(order) : false;

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
        if (wasDelivered || hasRefund) {
          // INR closed legitimately — delivered or refunded — no action needed
        } else {
          // INR closed, order never delivered to us, no refund — possible chargeback
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
