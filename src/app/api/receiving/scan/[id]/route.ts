import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const scanId = params.id;

  // Find the scan record
  const scan = await prisma.receiving_scans.findUnique({
    where: { id: scanId }
  });

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Find tracking numbers matching this scan's last8
  const trackingMatches = await prisma.tracking_numbers.findMany({
    where: { tracking_number: { endsWith: scan.tracking_last8 } },
    include: { shipment: true }
  });

  // Delete received_units associated with the matched orders
  const affectedOrderIds: string[] = [];
  for (const match of trackingMatches) {
    if (match.shipment) {
      affectedOrderIds.push(match.shipment.order_id);

      // Delete received_units for this order
      await prisma.received_units.deleteMany({
        where: { order_id: match.shipment.order_id }
      });

      // Clear checked_in_at on the shipment
      await prisma.shipments.update({
        where: { id: match.shipment.id },
        data: {
          checked_in_at: null,
          checked_in_by: null
        }
      });
    }
  }

  // Delete the scan record itself
  await prisma.receiving_scans.delete({
    where: { id: scanId }
  });

  return NextResponse.json({
    success: true,
    deletedScanId: scanId,
    affectedOrders: affectedOrderIds,
    message: `Scan deleted. Reversed check-in for ${affectedOrderIds.length} order(s).`
  });
}
