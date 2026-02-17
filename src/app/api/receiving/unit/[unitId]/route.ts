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

  // Delete the unit
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
    const isLot = shipment.expected_units === 1 && remainingUnits >= 1;
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
        checked_in_at: remainingUnits === 0 ? null : shipment.checked_in_at,
        checked_in_by: remainingUnits === 0 ? null : shipment.checked_in_by
      }
    });
  }

  return NextResponse.json({
    success: true,
    message: `Unit #${unit.unit_index} deleted. ${remainingUnits} units remaining.`,
    remainingUnits
  });
}
