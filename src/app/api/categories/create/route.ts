import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  categoryName: z.string().min(1).max(60),
  gtin: z.string().nullable().optional()
});

/**
 * POST /api/categories/create - Create a new category manually
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Check if category with this name already exists
    const existing = await prisma.item_categories.findFirst({
      where: {
        category_name: {
          equals: body.data.categoryName,
          mode: 'insensitive'
        }
      }
    });

    if (existing) {
      return NextResponse.json({
        error: "Category with this name already exists",
        existingCategory: existing
      }, { status: 409 });
    }

    // Create the category
    const category = await prisma.item_categories.create({
      data: {
        category_name: body.data.categoryName.trim(),
        gtin: body.data.gtin || null,
        category_keywords: []
      }
    });

    return NextResponse.json({
      ok: true,
      category
    });

  } catch (error: any) {
    console.error("Failed to create category:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create category" },
      { status: 500 }
    );
  }
}
