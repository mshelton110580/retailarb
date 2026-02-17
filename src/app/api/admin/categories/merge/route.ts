import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  fromCategoryId: z.string(),
  toCategoryId: z.string()
});

/**
 * POST /api/admin/categories/merge - Merge two existing categories
 * Transfers all units from source category to target category, then deletes source
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { fromCategoryId, toCategoryId } = body.data;

  if (fromCategoryId === toCategoryId) {
    return NextResponse.json({ error: "Source and target categories must be different" }, { status: 400 });
  }

  try {
    // Verify both categories exist
    const [fromCategory, toCategory] = await Promise.all([
      prisma.item_categories.findUnique({ where: { id: fromCategoryId } }),
      prisma.item_categories.findUnique({ where: { id: toCategoryId } })
    ]);

    if (!fromCategory) {
      return NextResponse.json({ error: "Source category not found" }, { status: 404 });
    }

    if (!toCategory) {
      return NextResponse.json({ error: "Target category not found" }, { status: 404 });
    }

    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Transfer all units from source to target category
      const updateResult = await tx.received_units.updateMany({
        where: { category_id: fromCategoryId },
        data: { category_id: toCategoryId }
      });

      // Delete any merge mappings pointing to the source category
      await tx.$executeRawUnsafe(
        `DELETE FROM category_merges WHERE to_category_id = $1`,
        fromCategoryId
      );

      // Delete the source category
      await tx.item_categories.delete({
        where: { id: fromCategoryId }
      });

      return {
        unitsTransferred: updateResult.count,
        fromCategoryName: fromCategory.category_name,
        toCategoryName: toCategory.category_name
      };
    });

    return NextResponse.json({
      ok: true,
      message: `Merged "${result.fromCategoryName}" into "${result.toCategoryName}"`,
      unitsTransferred: result.unitsTransferred
    });

  } catch (error: any) {
    console.error("Failed to merge categories:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to merge categories" },
      { status: 500 }
    );
  }
}
