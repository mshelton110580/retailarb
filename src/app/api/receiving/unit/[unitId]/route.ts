import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/receiving/unit/:unitId
 * Delete a single received unit (useful for lots where you scanned too many)
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ unitId: string }> }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { unitId } = await params;

  // Find the unit first
  const unit = await prisma.received_units.findUnique({
    where: { id: unitId },
    select: {
      id: true,
      order_id: true,
      unit_index: true
    }
  });

  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  // Delete unit_images first (FK constraint), then the unit
  await prisma.unit_images.deleteMany({
    where: { received_unit_id: unitId }
  });
  await prisma.received_units.delete({
    where: { id: unitId }
  });

  // Recalculate shipment scanned_units count
  const remainingUnits = await prisma.received_units.count({
    where: { order_id: unit.order_id }
  });

  // Update shipment
  const shipment = await prisma.shipments.findFirst({
    where: { order_id: unit.order_id }
  });

  if (shipment) {
    const isLot = remainingUnits > shipment.expected_units;
    const orderQty = shipment.expected_units;
    const lotSize = isLot && orderQty > 0
      ? Math.ceil(remainingUnits / orderQty)
      : null;
    let scanStatus: string;

    if (remainingUnits === 0) {
      scanStatus = "not_started";
    } else if (isLot) {
      scanStatus = "check_quantity";
    } else if (remainingUnits >= shipment.expected_units) {
      scanStatus = "complete";
    } else {
      scanStatus = "partial";
    }

    await prisma.shipments.update({
      where: { id: shipment.id },
      data: {
        scanned_units: remainingUnits,
        scan_status: scanStatus,
        is_lot: isLot,
        lot_size: lotSize,
        checked_in_at: remainingUnits === 0 ? null : shipment.checked_in_at,
        checked_in_by: remainingUnits === 0 ? null : shipment.checked_in_by
      }
    });

    // Clean up orphaned receiving_scans — keep only as many as remaining units
    const trackingNums = await prisma.tracking_numbers.findMany({
      where: { shipment_id: shipment.id },
      select: { tracking_number: true }
    });
    for (const tn of trackingNums) {
      const last8 = tn.tracking_number.replace(/\D/g, "").slice(-8);
      const scansForTracking = await prisma.receiving_scans.findMany({
        where: { tracking_last8: last8 },
        orderBy: { scanned_at: "desc" }
      });
      // Delete excess scan records (keep at most remainingUnits, minimum 0)
      const toDelete = scansForTracking.slice(remainingUnits);
      if (toDelete.length > 0) {
        await prisma.receiving_scans.deleteMany({
          where: { id: { in: toDelete.map(s => s.id) } }
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: `Unit #${unit.unit_index} deleted. ${remainingUnits} units remaining.`,
    remainingUnits
  });
}
