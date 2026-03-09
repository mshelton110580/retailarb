import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import ConditionManager from "./condition-manager";
import { BUILTIN_CONDITIONS } from "@/lib/conditions";

export default async function ConditionsAdminPage() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    redirect("/login");
  }

  // Get all distinct conditions in use
  const rows = await prisma.received_units.findMany({
    where: { condition_status: { not: "" } },
    select: { condition_status: true },
    distinct: ["condition_status"],
  });

  const conditionNames = rows.map(r => r.condition_status).filter((c): c is string => !!c);

  // Count units per condition
  const counts = await Promise.all(
    conditionNames.map(async name => ({
      name,
      count: await prisma.received_units.count({
        where: { condition_status: { equals: name, mode: "insensitive" } }
      })
    }))
  );
  const countMap = new Map(counts.map(c => [c.name.toLowerCase(), c.count]));
  const builtinSet = new Set(BUILTIN_CONDITIONS.map(c => c.toLowerCase()));

  const builtinConditions = BUILTIN_CONDITIONS.map(name => ({
    name,
    unitCount: countMap.get(name.toLowerCase()) ?? 0,
    isBuiltin: true
  }));

  const customConditions = conditionNames
    .filter(name => !builtinSet.has(name.toLowerCase()))
    .map(name => ({
      name,
      unitCount: countMap.get(name.toLowerCase()) ?? 0,
      isBuiltin: false
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const conditions = [...builtinConditions, ...customConditions];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Condition Management</h1>
          <p className="text-sm text-slate-400 mt-1">
            View all conditions, their unit counts, and delete unused custom conditions
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/products" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Products
          </Link>
          <Link href="/admin/users" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Users
          </Link>
        </div>
      </div>

      <ConditionManager conditions={conditions} />
    </div>
  );
}
