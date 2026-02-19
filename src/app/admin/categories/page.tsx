import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import CategoryManager from "./category-manager";

export default async function CategoriesAdminPage() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    redirect("/login");
  }

  // Get all categories with unit counts (including duplicates)
  const allCategories = await prisma.item_categories.findMany({
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

  // Group by normalized name to identify duplicates
  const duplicateGroups = new Map<string, typeof allCategories>();
  for (const cat of allCategories) {
    const normalized = cat.category_name.toLowerCase().trim();
    if (!duplicateGroups.has(normalized)) {
      duplicateGroups.set(normalized, []);
    }
    duplicateGroups.get(normalized)!.push(cat);
  }

  // Separate duplicates from unique categories
  const duplicates: Array<{ normalizedName: string; categories: typeof allCategories }> = [];
  const uniqueCategories: typeof allCategories = [];

  for (const [normalized, cats] of duplicateGroups.entries()) {
    if (cats.length > 1) {
      duplicates.push({ normalizedName: normalized, categories: cats });
    } else {
      uniqueCategories.push(cats[0]);
    }
  }

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Category Management</h1>
          <p className="text-sm text-slate-400 mt-1">
            Merge duplicate categories and manage category mappings
          </p>
        </div>
        <Link href="/admin/users" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Users
        </Link>
      </div>

      <CategoryManager
        allCategories={allCategories.map(c => ({
          id: c.id,
          category_name: c.category_name,
          gtin: c.gtin,
          unitCount: c._count.received_units
        }))}
        duplicates={duplicates.map(d => ({
          normalizedName: d.normalizedName,
          categories: d.categories.map(c => ({
            id: c.id,
            category_name: c.category_name,
            gtin: c.gtin,
            unitCount: c._count.received_units
          }))
        }))}
        uniqueCategories={uniqueCategories.map(c => ({
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
