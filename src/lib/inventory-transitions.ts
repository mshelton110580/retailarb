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
 * Compute the full set of inventory-state transitions across all units.
 * Read-only — writes nothing.
 *
 * Two passes:
 *   1. Return groups — every unit belonging to an (order_id, ebay_item_id)
 *      return group is evaluated against that group's returns/cases.
 *   2. Orphan pass — units with no return record but stuck at on_hand in
 *      bad condition.
 */
export async function planInventoryTransitions(): Promise<PlannedTransition[]> {
  const plan: PlannedTransition[] = [];
  const returns = await prisma.returns.findMany({
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
    const units = await prisma.received_units.findMany({
      where: { order_id: orderId, item_id: itemId },
      select: { id: true, inventory_state: true, condition_status: true }
    });
    const cases = await prisma.inr_cases.findMany({
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

  // Orphan pass: units with no return
  const orphans = await prisma.received_units.findMany({
    where: { inventory_state: "on_hand" },
    select: { id: true, order_id: true, item_id: true, inventory_state: true, condition_status: true }
  });
  for (const unit of orphans) {
    if (coveredUnitIds.has(unit.id)) continue;
    const to = evaluateUnitState(unit, [], []);
    if (to) {
      plan.push({
        unitId: unit.id,
        orderId: unit.order_id,
        itemId: unit.item_id,
        from: unit.inventory_state,
        to,
        reason: "bad condition, no return filed"
      });
    }
  }
  return plan;
}

/**
 * Apply a previously-computed transition plan. Writes inventory_state for
 * every planned unit and returns the number of units updated.
 */
export async function applyInventoryTransitions(plan: PlannedTransition[]): Promise<number> {
  for (const t of plan) {
    await prisma.received_units.update({ where: { id: t.unitId }, data: { inventory_state: t.to } });
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
    orphanPass: plan.filter(t => t.reason.startsWith("bad condition")).length
  };
}

/**
 * Manually update inventory state for a specific unit.
 * Used when user manually marks item for return or changes condition.
 */
export async function updateUnitInventoryState(
  unitId: string,
  newState: "on_hand" | "to_be_returned" | "parts_repair" | "fair" | "returned"
) {
  await prisma.received_units.update({
    where: { id: unitId },
    data: { inventory_state: newState }
  });
}
