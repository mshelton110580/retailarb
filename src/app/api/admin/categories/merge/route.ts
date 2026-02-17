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

      // IMPORTANT: Create a merge mapping to preserve the alias
      // This ensures if "fromCategoryName" is detected again, it auto-merges to target
      await tx.$executeRawUnsafe(
        `INSERT INTO category_merges (id, from_category_name, to_category_id, created_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT (from_category_name)
         DO UPDATE SET to_category_id = $2, created_by = $3`,
        fromCategory.category_name,
        toCategoryId,
        auth.session.user.id
      );

      // Delete any merge mappings pointing to the source category (redirect them)
      // First, get all mappings pointing to the source
      const mappingsToRedirect = await tx.$queryRawUnsafe<Array<{ from_category_name: string }>>(
        `SELECT from_category_name FROM category_merges WHERE to_category_id = $1`,
        fromCategoryId
      );

      // Update them to point to the new target instead
      if (mappingsToRedirect.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE category_merges SET to_category_id = $1 WHERE to_category_id = $2`,
          toCategoryId,
          fromCategoryId
        );
      }

      // Delete the source category
      await tx.item_categories.delete({
        where: { id: fromCategoryId }
      });

      return {
        unitsTransferred: updateResult.count,
        fromCategoryName: fromCategory.category_name,
        toCategoryName: toCategory.category_name,
        aliasesPreserved: 1 + mappingsToRedirect.length // The deleted category + any mappings it had
      };
    });

    return NextResponse.json({
      ok: true,
      message: `Merged "${result.fromCategoryName}" into "${result.toCategoryName}"`,
      unitsTransferred: result.unitsTransferred,
      aliasesPreserved: result.aliasesPreserved
    });

  } catch (error: any) {
    console.error("Failed to merge categories:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to merge categories" },
      { status: 500 }
    );
  }
}
