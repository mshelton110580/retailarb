import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/receiving/order/:orderId
 * Delete all received units for an order and reset its shipment check-in state.
 * Used for imported (CSV) entries that don't have a scan record.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { orderId: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { orderId } = params;

  const units = await prisma.received_units.findMany({
    where: { order_id: orderId },
    select: { id: true }
  });

  if (units.length === 0) {
    return NextResponse.json({ error: "No units found for this order" }, { status: 404 });
  }

  // Delete related records (FK constraints), then units
  const unitIds = units.map(u => u.id);
  await prisma.unit_images.deleteMany({
    where: { received_unit_id: { in: unitIds } }
  });
  await prisma.upload_sessions.deleteMany({
    where: { received_unit_id: { in: unitIds } }
  });
  await prisma.lot_units.deleteMany({
    where: { received_unit_id: { in: unitIds } }
  });
  await prisma.received_units.deleteMany({
    where: { order_id: orderId }
  });

  // Reset shipment check-in state
  const shipment = await prisma.shipments.findFirst({
    where: { order_id: orderId }
  });

  if (shipment) {
    await prisma.shipments.update({
      where: { id: shipment.id },
      data: {
        scanned_units: 0,
        scan_status: "pending",
        is_lot: false,
        lot_size: null,
        checked_in_at: null,
        checked_in_by: null
      }
    });
  }

  return NextResponse.json({
    success: true,
    deletedUnits: units.length,
    message: `Deleted ${units.length} unit${units.length !== 1 ? "s" : ""} for order ${orderId}.`
  });
}
