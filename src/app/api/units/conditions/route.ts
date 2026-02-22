import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

const BUILTIN_CONDITIONS = [
  "good", "new", "like_new", "acceptable", "excellent",
  "pressure mark", "damaged", "wrong_item", "missing_parts",
  "defective", "dim power/ glitchy", "no power", "cracked screen",
  "water damage", "parts only"
];

/**
 * GET /api/units/conditions
 * Returns the union of built-in conditions and any distinct condition_status
 * values already present in received_units (covers custom conditions added over time).
 */
export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rows = await prisma.received_units.findMany({
    where: { condition_status: { not: "" } },
    select: { condition_status: true },
    distinct: ["condition_status"],
    orderBy: { condition_status: "asc" }
  });

  const dbConditions = rows.map(r => r.condition_status).filter(Boolean);

  // Merge: builtins first, then any db-only extras, deduped case-insensitively
  const seen = new Set(BUILTIN_CONDITIONS.map(c => c.toLowerCase()));
  const extra = dbConditions.filter(c => !seen.has(c.toLowerCase()));
  const conditions = [...BUILTIN_CONDITIONS, ...extra];

  return NextResponse.json({ conditions });
}
