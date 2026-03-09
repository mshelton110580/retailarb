import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import ProductManager from "./product-manager";

export default async function ProductsAdminPage() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    redirect("/login");
  }

  // Get all products with unit counts (including duplicates)
  const allProducts = await prisma.products.findMany({
    select: {
      id: true,
      product_name: true,
      gtin: true,
      _count: {
        select: {
          received_units: true
        }
      }
    },
    orderBy: {
      product_name: "asc"
    }
  });

  // Group by normalized name to identify duplicates
  const duplicateGroups = new Map<string, typeof allProducts>();
  for (const p of allProducts) {
    const normalized = p.product_name.toLowerCase().trim();
    if (!duplicateGroups.has(normalized)) {
      duplicateGroups.set(normalized, []);
    }
    duplicateGroups.get(normalized)!.push(p);
  }

  // Separate duplicates from unique products
  const duplicates: Array<{ normalizedName: string; products: typeof allProducts }> = [];
  const uniqueProducts: typeof allProducts = [];

  for (const [normalized, prods] of duplicateGroups.entries()) {
    if (prods.length > 1) {
      duplicates.push({ normalizedName: normalized, products: prods });
    } else {
      uniqueProducts.push(prods[0]);
    }
  }

  // Get merge mappings
  const merges = await prisma.$queryRawUnsafe<Array<{
    id: string;
    from_product_name: string;
    to_product_id: string;
    created_at: Date;
  }>>(
    `SELECT id, from_product_name, to_product_id, created_at
     FROM product_aliases
     ORDER BY created_at DESC`
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Product Management</h1>
          <p className="text-sm text-slate-400 mt-1">
            Merge duplicate products and manage product mappings
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/conditions" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Conditions
          </Link>
          <Link href="/admin/users" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Users
          </Link>
        </div>
      </div>

      <ProductManager
        allProducts={allProducts.map(p => ({
          id: p.id,
          product_name: p.product_name,
          gtin: p.gtin,
          unitCount: p._count.received_units
        }))}
        duplicates={duplicates.map(d => ({
          normalizedName: d.normalizedName,
          products: d.products.map(p => ({
            id: p.id,
            product_name: p.product_name,
            gtin: p.gtin,
            unitCount: p._count.received_units
          }))
        }))}
        uniqueProducts={uniqueProducts.map(p => ({
          id: p.id,
          product_name: p.product_name,
          gtin: p.gtin,
          unitCount: p._count.received_units
        }))}
        merges={merges.map(m => ({
          id: m.id,
          fromProductName: m.from_product_name,
          toProductId: m.to_product_id,
          createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at)
        }))}
      />
    </div>
  );
}
