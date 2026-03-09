import { requireRole } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import UnitsTable from "./units-table";

export default async function UnitsPage() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) redirect("/login");

  const products = await prisma.products.findMany({
    select: { id: true, product_name: true },
    orderBy: { product_name: "asc" }
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Units</h1>
        <p className="text-sm text-slate-400 mt-1">
          Search, filter, and bulk-edit received units
        </p>
      </div>
      <UnitsTable products={products.map(p => ({ id: p.id, product_name: p.product_name }))} />
    </div>
  );
}
