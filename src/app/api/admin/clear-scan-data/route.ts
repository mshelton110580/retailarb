import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * POST /api/admin/clear-scan-data
 * Clears all receiving/scan data:
 * - Deletes all received_units
 * - Deletes all receiving_scans
 * - Resets all shipments: scanned_units=0, scan_status='pending', is_lot=false, checked_in_at=null
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const [deletedUnits, deletedScans, resetShipments] = await Promise.all([
    prisma.received_units.deleteMany({}),
    prisma.receiving_scans.deleteMany({}),
    prisma.shipments.updateMany({
      data: {
        scanned_units: 0,
        scan_status: "pending",
        is_lot: false,
        checked_in_at: null,
        checked_in_by: null,
      }
    })
  ]);

  return NextResponse.json({
    ok: true,
    deletedUnits: deletedUnits.count,
    deletedScans: deletedScans.count,
    resetShipments: resetShipments.count,
  });
}
