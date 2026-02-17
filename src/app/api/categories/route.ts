import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

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
