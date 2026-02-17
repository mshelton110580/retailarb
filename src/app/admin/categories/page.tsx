import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import CategoryManager from "./category-manager";

export default async function CategoriesAdminPage() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    redirect("/login");
  }

  // Get all categories with unit counts
  const categories = await prisma.item_categories.findMany({
    select: {
      id: true,
      category_name: true,
      gtin: true,
      _count: {
        select: {
          received_units: true
        }
      }
    },
    orderBy: {
      category_name: "asc"
    }
  });

  // Get merge mappings
  const merges = await prisma.$queryRawUnsafe<Array<{
    id: string;
    from_category_name: string;
    to_category_id: string;
    created_at: Date;
  }>>(
    `SELECT id, from_category_name, to_category_id, created_at
     FROM category_merges
     ORDER BY created_at DESC`
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Category Management</h1>
        <p className="text-sm text-slate-400 mt-1">
          Merge duplicate categories and manage category mappings
        </p>
      </div>

      <CategoryManager
        categories={categories.map(c => ({
          id: c.id,
          category_name: c.category_name,
          gtin: c.gtin,
          unitCount: c._count.received_units
        }))}
        merges={merges.map(m => ({
          id: m.id,
          fromCategoryName: m.from_category_name,
          toCategoryId: m.to_category_id,
          createdAt: m.created_at.toISOString()
        }))}
      />
    </div>
  );
}
