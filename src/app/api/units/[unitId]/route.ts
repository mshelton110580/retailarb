import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

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
    select: { id: true }
  });
  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  const updated = await prisma.received_units.update({
    where: { id: unitId },
    data,
    select: { id: true, condition_status: true, notes: true, category_id: true }
  });

  return NextResponse.json({ ok: true, unit: updated });
}
