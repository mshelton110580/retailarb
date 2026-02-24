import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { computeInventoryState } from "@/lib/item-categorization";

/**
 * PATCH /api/units/:unitId
 * Update condition_status, notes, and/or category_id on a single unit.
 * Body: { condition?: string; notes?: string; categoryId?: string | null }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ unitId: string }> }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { unitId } = await params;
  const body = await req.json();

  const data: Record<string, any> = {};

  if (typeof body.condition === "string" && body.condition.trim()) {
    data.condition_status = body.condition.trim();
  }
  if (typeof body.notes === "string") {
    data.notes = body.notes.trim() || null;
  }
  if ("categoryId" in body) {
    if (body.categoryId === null) {
      data.category_id = null;
    } else if (typeof body.categoryId === "string" && body.categoryId.trim()) {
      const cat = await prisma.item_categories.findUnique({ where: { id: body.categoryId } });
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
      data.category_id = body.categoryId;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
  }

  const unit = await prisma.received_units.findUnique({
    where: { id: unitId },
    select: { id: true, order_id: true, item_id: true, condition_status: true }
  });
  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  // When condition changes, recompute inventory_state using the same logic as
  // the bulk route and the original scan path.
  if (data.condition_status) {
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

    let inventoryState = computeInventoryState(data.condition_status);

    if (existingReturn) {
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
          inventoryState = "to_be_returned";
        }
      } else {
        inventoryState = "to_be_returned";
      }
    }

    data.inventory_state = inventoryState;
  }

  const updated = await prisma.received_units.update({
    where: { id: unitId },
    data,
    select: { id: true, condition_status: true, notes: true, category_id: true, inventory_state: true }
  });

  return NextResponse.json({ ok: true, unit: updated });
}
