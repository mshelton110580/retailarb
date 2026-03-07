import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { onCategoryCreated } from "@/lib/ai";

/**
 * GET /api/categories - List all categories (deduplicated)
 */
export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const allCategories = await prisma.item_categories.findMany({
    select: {
      id: true,
      category_name: true,
      gtin: true,
      category_keywords: true
    },
    orderBy: {
      category_name: 'asc'
    }
  });

  // Deduplicate by category_name (case-insensitive)
  // Keep the first occurrence of each unique name
  const seen = new Map<string, typeof allCategories[0]>();
  for (const cat of allCategories) {
    const normalized = cat.category_name.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.set(normalized, cat);
    }
  }

  const categories = Array.from(seen.values()).sort((a, b) =>
    a.category_name.localeCompare(b.category_name)
  );

  return NextResponse.json({ categories });
}

const createSchema = z.object({
  name: z.string().min(1, "Category name is required")
});

/**
 * POST /api/categories - Create a new category
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = createSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Check if category already exists (case-insensitive)
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string; category_name: string }>>(
      `SELECT id, category_name FROM item_categories WHERE LOWER(TRIM(category_name)) = $1 LIMIT 1`,
      body.data.name.toLowerCase().trim()
    );

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Category "${existing[0].category_name}" already exists`, category: existing[0] },
        { status: 409 }
      );
    }

    // Create new category
    const category = await prisma.item_categories.create({
      data: {
        category_name: body.data.name,
        gtin: null
      }
    });

    await onCategoryCreated(category.id, category.category_name);

    return NextResponse.json({ category, message: `Category "${category.category_name}" created successfully` });
  } catch (error: any) {
    console.error("Failed to create category:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create category" },
      { status: 500 }
    );
  }
}
