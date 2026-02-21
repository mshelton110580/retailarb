import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { computeInventoryState } from "@/lib/item-categorization";

/**
 * PATCH /api/units/bulk
 * Bulk update category or condition_status on multiple units.
 *
 * When condition changes, inventory_state is recomputed using the same logic
 * as the original scan path: condition + existing return status for that unit.
 *
 * Body: {
 *   unitIds: string[]
 *   updates: {
 *     categoryId?: string | null
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
      condition?: string;
    };
  };

  if (!unitIds || unitIds.length === 0) {
    return NextResponse.json({ error: "unitIds required" }, { status: 400 });
  }

  const baseData: Record<string, any> = {};

  if ("categoryId" in updates) {
    if (updates.categoryId !== null && updates.categoryId !== undefined) {
      const cat = await prisma.item_categories.findUnique({ where: { id: updates.categoryId } });
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }
    baseData.category_id = updates.categoryId ?? null;
  }

  if (updates.condition) {
    baseData.condition_status = updates.condition;
  }

  if (Object.keys(baseData).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
  }

  // If condition is changing, recompute state per-unit using the same logic as
  // the original scan: condition + that unit's return status.
  if (updates.condition) {
    const units = await prisma.received_units.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, order_id: true, item_id: true }
    });

    let updated = 0;
    for (const unit of units) {
      // Look up return for this order/item — same query as the scan route
      const existingReturn = await prisma.returns.findFirst({
        where: { order_id: unit.order_id, item_id: unit.item_id },
        select: {
          ebay_state: true,
          ebay_status: true,
          return_shipped_date: true,
          return_delivered_date: true,
          refund_issued_date: true,
          actual_refund: true
        }
      });

      // Replicate scan route state logic exactly
      let inventoryState = computeInventoryState(updates.condition);

      if (existingReturn) {
        const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
        const isClosed =
          existingReturn.ebay_state === "CLOSED" ||
          existingReturn.ebay_status === "CLOSED" ||
          existingReturn.ebay_state === "REFUND_ISSUED" ||
          existingReturn.ebay_state === "RETURN_CLOSED" ||
          existingReturn.ebay_status === "REFUND_ISSUED" ||
          existingReturn.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";

        if (existingReturn.return_shipped_date || existingReturn.return_delivered_date) {
          inventoryState = "returned";
        } else if (isClosed) {
          if (existingReturn.refund_issued_date || existingReturn.actual_refund) {
            inventoryState = "parts_repair";
          } else {
            // Closed with no refund and no return tracking — possible chargeback
            inventoryState = "possible_chargeback";
          }
        } else {
          inventoryState = "to_be_returned";
        }
      }

      await prisma.received_units.update({
        where: { id: unit.id },
        data: { ...baseData, inventory_state: inventoryState }
      });
      updated++;
    }

    return NextResponse.json({ ok: true, updated });
  }

  // Category-only update — no state recomputation needed
  const result = await prisma.received_units.updateMany({
    where: { id: { in: unitIds } },
    data: baseData
  });

  return NextResponse.json({ ok: true, updated: result.count });
}
