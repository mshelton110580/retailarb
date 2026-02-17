import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  fromCategoryName: z.string(),
  toCategoryId: z.string()
});

/**
 * POST /api/categories/merge - Create a category merge mapping
 * When a new category name should map to an existing category
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Verify target category exists
    const targetCategory = await prisma.item_categories.findUnique({
      where: { id: body.data.toCategoryId }
    });

    if (!targetCategory) {
      return NextResponse.json({ error: "Target category not found" }, { status: 404 });
    }

    // Create or update merge mapping
    const merge = await prisma.$queryRawUnsafe(
      `INSERT INTO category_merges (id, from_category_name, to_category_id, created_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       ON CONFLICT (from_category_name)
       DO UPDATE SET to_category_id = $2, created_by = $3
       RETURNING id`,
      body.data.fromCategoryName,
      body.data.toCategoryId,
      auth.session.user.id
    );

    return NextResponse.json({
      ok: true,
      merge,
      message: `"${body.data.fromCategoryName}" will now be merged into "${targetCategory.category_name}"`
    });

  } catch (error: any) {
    console.error("Failed to create category merge:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create merge" },
      { status: 500 }
    );
  }
}
