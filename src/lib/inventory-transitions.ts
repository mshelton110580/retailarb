import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateUnitState } from "@/lib/inventory-evaluator";

export type PlannedTransition = {
  unitId: string;
  orderId: string;
  itemId: string | null;
  from: string;
  to: string;
  reason: string;
};

/**
 * A regular PrismaClient or an in-flight `$transaction` callback client.
 * Passing a transaction client lets callers (e.g. the reclassify script's
 * dry-run mode) run planning against writes that haven't committed yet,
 * then roll everything back — making the preview byte-for-byte faithful
 * to what `--apply` would actually do.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

// Refunded = the order's current total dropped below its original (full OR
// partial refund). Used by the no-return evaluator path: the buyer was
// compensated without a return -> the unit is never needs-return.
function isOrderRefunded(order: { original_total: unknown; totals: unknown } | null | undefined): boolean {
  if (!order) return false;
  const orig = order.original_total != null ? Number(order.original_total) : null;
  const cur = order.totals && typeof order.totals === "object" && "total" in (order.totals as any)
    ? Number((order.totals as any).total)
    : null;
  return orig != null && cur != null && orig > 0 && orig - cur > 0.005;
}

/**
 * Compute the full set of inventory-state transitions across all units.
 * Read-only against `db` — writes nothing itself. When `db` is a
 * transaction client that the caller later rolls back, the plan reflects
 * whatever that transaction has (uncommitted) written so far.
 *
 * Two passes:
 *   1. Return groups — every unit belonging to an (order_id, ebay_item_id)
 *      return group is evaluated against that group's returns/cases.
 *   2. Orphan pass — units with no return record that are either stuck at
 *      on_hand in bad condition, or stuck at to_be_returned in good
 *      condition (e.g. condition was corrected but no return was ever
 *      filed).
 */
export async function planInventoryTransitions(db: Db = prisma): Promise<PlannedTransition[]> {
  const plan: PlannedTransition[] = [];
  const returns = await db.returns.findMany({
    where: { order_id: { not: null } },
    select: {
      id: true,
      order_id: true,
      ebay_item_id: true,
      ebay_state: true,
      ebay_status: true,
      escalated: true,
      case_id: true,
      creation_date: true,
      return_shipped_date: true,
      return_delivered_date: true
    }
  });

  // Group returns by (order_id, ebay_item_id); never wildcard-match on null item id
  const groups = new Map<string, typeof returns>();
  for (const r of returns) {
    if (!r.ebay_item_id) {
      console.warn(`[Inventory Transition] Return ${r.id} has null ebay_item_id — skipped`);
      continue;
    }
    const key = `${r.order_id}::${r.ebay_item_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const coveredUnitIds = new Set<string>();
  for (const [key, groupReturns] of groups) {
    const [orderId, itemId] = key.split("::");
    const units = await db.received_units.findMany({
      where: { order_id: orderId, item_id: itemId },
      select: { id: true, inventory_state: true, condition_status: true }
    });
    const cases = await db.inr_cases.findMany({
      where: { order_id: orderId, ebay_item_id: itemId, case_id: { not: null } },
      select: { case_id: true, ebay_status: true }
    });
    for (const unit of units) {
      coveredUnitIds.add(unit.id);
      const to = evaluateUnitState(unit, groupReturns, cases);
      if (to) {
        plan.push({
          unitId: unit.id,
          orderId,
          itemId,
          from: unit.inventory_state,
          to,
          reason: `return group (${groupReturns.length} return(s), ${cases.length} case(s))`
        });
      }
    }
  }

  // Orphan pass: units with no return. Covers both directions the evaluator
  // can flip an orphan: bad-condition on_hand -> to_be_returned, and
  // good-condition to_be_returned (stuck with no return record) -> on_hand.
  // INR cases are consulted here too: a unit with an INR case is never
  // needs-return (INR cases are not returns) — it lands in the kept outcomes.
  const orphans = await db.received_units.findMany({
    where: { inventory_state: { in: ["on_hand", "to_be_returned"] } },
    select: { id: true, order_id: true, item_id: true, inventory_state: true, condition_status: true }
  });
  // Prefetch all INR/case rows once and index by (order_id, ebay_item_id)
  const allInrRows = await db.inr_cases.findMany({
    where: { order_id: { not: null }, ebay_item_id: { not: null } },
    select: { order_id: true, ebay_item_id: true, case_id: true, ebay_status: true }
  });
  const inrByPair = new Map<string, { case_id: string | null; ebay_status: string | null }[]>();
  for (const c of allInrRows) {
    const k = `${c.order_id}::${c.ebay_item_id}`;
    if (!inrByPair.has(k)) inrByPair.set(k, []);
    inrByPair.get(k)!.push({ case_id: c.case_id, ebay_status: c.ebay_status });
  }
  // Prefetch orphan orders' refund state (full refund clears needs-return)
  const orphanOrderIds = [...new Set(orphans.map(u => u.order_id))];
  const refundedOrders = new Set<string>();
  for (let i = 0; i < orphanOrderIds.length; i += 500) {
    const chunk = await db.orders.findMany({
      where: { order_id: { in: orphanOrderIds.slice(i, i + 500) } },
      select: { order_id: true, original_total: true, totals: true }
    });
    for (const o of chunk) if (isOrderRefunded(o)) refundedOrders.add(o.order_id);
  }

  for (const unit of orphans) {
    if (coveredUnitIds.has(unit.id)) continue;
    const inrCases = inrByPair.get(`${unit.order_id}::${unit.item_id}`) ?? [];
    const refunded = refundedOrders.has(unit.order_id);
    const to = evaluateUnitState(unit, [], inrCases, refunded);
    if (to) {
      plan.push({
        unitId: unit.id,
        orderId: unit.order_id,
        itemId: unit.item_id,
        from: unit.inventory_state,
        to,
        reason: inrCases.length > 0
          ? `INR case on item (${inrCases.length}) — not a return`
          : refunded
            ? "order refunded (full or partial), no return needed"
            : to === "to_be_returned"
              ? "bad condition, no return filed"
              : "good condition, no return filed (rescued from to_be_returned)"
      });
    }
  }
  return plan;
}

/**
 * Apply a previously-computed transition plan. Writes inventory_state for
 * every planned unit and returns the number of units updated.
 */
export async function applyInventoryTransitions(plan: PlannedTransition[], db: Db = prisma): Promise<number> {
  for (const t of plan) {
    await db.received_units.update({ where: { id: t.unitId }, data: { inventory_state: t.to } });
    console.log(`[Inventory Transition] ${t.unitId}: ${t.from} -> ${t.to} (${t.reason})`);
  }
  return plan.length;
}

/**
 * Update inventory states based on return status changes.
 * Called when returns are synced from eBay.
 */
export async function updateInventoryStatesFromReturns(): Promise<void> {
  await applyInventoryTransitions(await planInventoryTransitions());
}

/**
 * Full recompute of inventory states across all units.
 * Returns counts of changes made, split by pass (return-group vs orphan),
 * for the admin UI.
 */
export async function recomputeAllInventoryStates(): Promise<{
  returnPass: number;
  orphanPass: number;
}> {
  const plan = await planInventoryTransitions();
  await applyInventoryTransitions(plan);
  return {
    returnPass: plan.filter(t => t.reason.startsWith("return group")).length,
    orphanPass: plan.filter(t => !t.reason.startsWith("return group")).length
  };
}

/**
 * Re-evaluate a single unit's inventory state from its current condition,
 * returns, and linked cases — the same evaluator the bulk planner uses.
 * Loads the unit fresh (so it reflects any just-committed condition change),
 * fetches its return group and linked cases exactly as `planInventoryTransitions`
 * does, and applies the update only if the evaluator computes a different state.
 * Returns the new state, or null if nothing changed (or the unit doesn't exist).
 */
export async function reevaluateUnit(unitId: string, db: Db = prisma): Promise<string | null> {
  const unit = await db.received_units.findUnique({
    where: { id: unitId },
    select: { id: true, order_id: true, item_id: true, inventory_state: true, condition_status: true }
  });
  if (!unit) return null;

  const returns = await db.returns.findMany({
    where: { order_id: unit.order_id, ebay_item_id: unit.item_id },
    select: {
      ebay_state: true,
      ebay_status: true,
      escalated: true,
      case_id: true,
      creation_date: true,
      return_shipped_date: true,
      return_delivered_date: true
    }
  });
  // No case_id filter: plain INR inquiries (case_id null) matter too — the
  // evaluator treats any INR row as "not needs-return" when no return exists.
  const cases = await db.inr_cases.findMany({
    where: { order_id: unit.order_id, ebay_item_id: unit.item_id },
    select: { case_id: true, ebay_status: true }
  });
  const order = await db.orders.findUnique({
    where: { order_id: unit.order_id },
    select: { original_total: true, totals: true }
  });

  const to = evaluateUnitState(unit, returns, cases, isOrderRefunded(order));
  if (!to) return null;

  await db.received_units.update({ where: { id: unitId }, data: { inventory_state: to } });
  return to;
}

/**
 * Manually update inventory state for a specific unit.
 * Used when user manually marks item for return or changes condition.
 */
export async function updateUnitInventoryState(
  unitId: string,
  newState: "on_hand" | "to_be_returned" | "return_filed" | "return_escalated" | "parts_repair" | "fair" | "returned" | "missing"
) {
  await prisma.received_units.update({
    where: { id: unitId },
    data: { inventory_state: newState }
  });
}
