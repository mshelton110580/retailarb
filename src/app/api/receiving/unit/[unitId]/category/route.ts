import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  categoryId: z.string().nullable()
});

/**
 * PATCH /api/receiving/unit/[unitId]/category - Update unit category
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
  const body = schema.safeParse(await req.json());

  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Verify unit exists
    const unit = await prisma.received_units.findUnique({
      where: { id: unitId }
    });

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Verify category exists if provided
    if (body.data.categoryId) {
      const category = await prisma.item_categories.findUnique({
        where: { id: body.data.categoryId }
      });

      if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }

    // Update the unit's category
    const updatedUnit = await prisma.received_units.update({
      where: { id: unitId },
      data: {
        category_id: body.data.categoryId
      },
      select: {
        id: true,
        category_id: true,
        category: {
          select: {
            id: true,
            category_name: true
          }
        }
      }
    });

    return NextResponse.json({
      ok: true,
      unit: updatedUnit
    });

  } catch (error: any) {
    console.error("Failed to update unit category:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to update category" },
      { status: 500 }
    );
  }
}
