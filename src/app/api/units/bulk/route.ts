import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { computeInventoryState } from "@/lib/item-categorization";

/**
 * PATCH /api/units/bulk
 * Bulk update category, inventory_state, or condition_status on multiple units.
 *
 * Body: {
 *   unitIds: string[]
 *   updates: {
 *     categoryId?: string | null
 *     state?: "on_hand" | "to_be_returned" | "parts_repair" | "returned"
 *     condition?: string
 *   }
 * }
 */
export async function PATCH(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const { unitIds, updates } = body as {
    unitIds: string[];
    updates: {
      categoryId?: string | null;
      state?: string;
      condition?: string;
    };
  };

  if (!unitIds || unitIds.length === 0) {
    return NextResponse.json({ error: "unitIds required" }, { status: 400 });
  }

  const data: Record<string, any> = {};

  if ("categoryId" in updates) {
    if (updates.categoryId !== null && updates.categoryId !== undefined) {
      // Verify category exists
      const cat = await prisma.item_categories.findUnique({ where: { id: updates.categoryId } });
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }
    data.category_id = updates.categoryId ?? null;
  }

  // State is not directly editable — it is derived from condition.
  // (Explicit state updates are intentionally not supported here.)

  if (updates.condition) {
    data.condition_status = updates.condition;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
  }

  // When condition is changing, auto-derive inventory_state for units whose
  // current state is condition-driven (on_hand or to_be_returned).
  // Units with returned / parts_repair / missing keep their state — those are
  // set by external events (returns, lot reconciliation) not by condition alone.
  let updated = 0;
  if (updates.condition) {
    const CONDITION_DRIVEN_STATES = ["on_hand", "to_be_returned"];
    const derivedState = computeInventoryState(updates.condition);
    // Units with a condition-driven state: update both condition and state
    const conditionDrivenResult = await prisma.received_units.updateMany({
      where: { id: { in: unitIds }, inventory_state: { in: CONDITION_DRIVEN_STATES } },
      data: { ...data, inventory_state: derivedState }
    });
    // Units with a protected state (returned/parts_repair/missing): update condition only
    const protectedResult = await prisma.received_units.updateMany({
      where: { id: { in: unitIds }, inventory_state: { notIn: CONDITION_DRIVEN_STATES } },
      data
    });
    updated = conditionDrivenResult.count + protectedResult.count;
  } else {
    const result = await prisma.received_units.updateMany({
      where: { id: { in: unitIds } },
      data
    });
    updated = result.count;
  }

  return NextResponse.json({
    ok: true,
    updated
  });
}
