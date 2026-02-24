import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { recomputeAllInventoryStates } from "@/lib/inventory-transitions";

/**
 * POST /api/admin/recompute-states
 * Recomputes inventory_state for all received_units based on current
 * return data and condition. Admin only.
 */
export async function POST() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const result = await recomputeAllInventoryStates();

  return NextResponse.json({
    ok: true,
    returnPass: result.returnPass,
    orphanPass: result.orphanPass,
    total: result.returnPass + result.orphanPass,
  });
}
