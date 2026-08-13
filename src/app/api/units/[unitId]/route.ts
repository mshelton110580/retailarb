import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { reevaluateUnit } from "@/lib/inventory-transitions";

/**
 * PATCH /api/units/:unitId
 * Update condition_status, notes, and/or product_id on a single unit.
 * Body: { condition?: string; notes?: string; productId?: string | null }
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
  if ("productId" in body) {
    if (body.productId === null) {
      data.product_id = null;
    } else if (typeof body.productId === "string" && body.productId.trim()) {
      const prod = await prisma.products.findUnique({ where: { id: body.productId } });
      if (!prod) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      data.product_id = body.productId;
    }
  }
  // Backward compatibility: also accept categoryId
  if ("categoryId" in body && !("productId" in body)) {
    if (body.categoryId === null) {
      data.product_id = null;
    } else if (typeof body.categoryId === "string" && body.categoryId.trim()) {
      const prod = await prisma.products.findUnique({ where: { id: body.categoryId } });
      if (!prod) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      data.product_id = body.categoryId;
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

  const conditionChanged = Boolean(data.condition_status);

  const updated = await prisma.received_units.update({
    where: { id: unitId },
    data,
    select: { id: true, condition_status: true, notes: true, product_id: true, inventory_state: true }
  });

  // When condition changes, re-evaluate inventory_state with the evaluator —
  // the single source of truth shared with the bulk transition planner —
  // rather than duplicating condition->state logic here.
  let reevaluatedState: string | null = null;
  if (conditionChanged) {
    reevaluatedState = await reevaluateUnit(unitId);
    if (reevaluatedState) {
      updated.inventory_state = reevaluatedState;
    }
  }

  return NextResponse.json({ ok: true, unit: updated, reevaluatedState });
}
