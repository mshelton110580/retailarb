import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  productId: z.string().nullable()
});

/**
 * PATCH /api/receiving/unit/[unitId]/product - Update unit product
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

    // Verify product exists if provided
    if (body.data.productId) {
      const product = await prisma.products.findUnique({
        where: { id: body.data.productId }
      });

      if (!product) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
    }

    // Update the unit's product
    const updatedUnit = await prisma.received_units.update({
      where: { id: unitId },
      data: {
        product_id: body.data.productId
      },
      select: {
        id: true,
        product_id: true,
        product: {
          select: {
            id: true,
            product_name: true
          }
        }
      }
    });

    return NextResponse.json({
      ok: true,
      unit: updatedUnit
    });

  } catch (error: any) {
    console.error("Failed to update unit product:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to update product" },
      { status: 500 }
    );
  }
}
