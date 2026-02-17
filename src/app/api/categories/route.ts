import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * GET /api/categories - List all categories
 */
export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const categories = await prisma.item_categories.findMany({
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

  return NextResponse.json({ categories });
}
