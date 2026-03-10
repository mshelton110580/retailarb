import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";

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

  const affectedOrderIds: string[] = [];

  for (const match of trackingMatches) {
    if (!match.shipment) continue;
    const shipment = match.shipment;
    affectedOrderIds.push(shipment.order_id);

    // Delete related records (FK constraints), then received_units
    const unitIds = await prisma.received_units.findMany({
      where: { order_id: shipment.order_id },
      select: { id: true }
    });
    const ids = unitIds.map(u => u.id);
    await prisma.unit_images.deleteMany({
      where: { received_unit_id: { in: ids } }
    });
    await prisma.upload_sessions.deleteMany({
      where: { received_unit_id: { in: ids } }
    });
    await prisma.lot_units.deleteMany({
      where: { received_unit_id: { in: ids } }
    });
    await prisma.received_units.deleteMany({
      where: { order_id: shipment.order_id }
    });

    // Check if there are other scans (besides the one being deleted) for this same tracking
    const otherScans = await prisma.receiving_scans.findMany({
      where: {
        tracking_last8: scan.tracking_last8,
        id: { not: scanId }
      }
    });

    if (otherScans.length === 0) {
      // No other scans for this tracking — fully reset the shipment
      await prisma.shipments.update({
        where: { id: shipment.id },
        data: {
          checked_in_at: null,
          checked_in_by: null,
          scanned_units: 0,
          scan_status: "pending",
          is_lot: false
        }
      });
    } else {
      // There are still other scans for this tracking — recalculate from remaining scans
      const remainingUnits = otherScans.length;
      const expectedUnits = shipment.expected_units;
      const isLot = expectedUnits === 1 && remainingUnits > 1;

      let scanStatus: string;
      if (remainingUnits === 0) {
        scanStatus = "pending";
      } else if (isLot) {
        scanStatus = "check_quantity";
      } else if (remainingUnits >= expectedUnits) {
        scanStatus = "complete";
      } else {
        scanStatus = "partial";
      }

      // Re-create received_units from remaining scans
      // We need to rebuild them since we deleted all above
      const firstOtherScan = otherScans[0];
      for (let i = 0; i < remainingUnits; i++) {
        const otherScan = otherScans[i];
        // Get the order items to find the listing/item info
        const orderItems = await prisma.order_items.findMany({
          where: { order_id: shipment.order_id }
        });
        const firstItem = orderItems[0];
        if (!firstItem) continue;

        // Ensure target and listing exist
        const existingTarget = await prisma.targets.findUnique({
          where: { item_id: firstItem.item_id }
        });
        if (!existingTarget) {
          await prisma.targets.create({
            data: {
              item_id: firstItem.item_id,
              type: TargetType.BIN,
              status: TargetStatus.PURCHASED,
              lead_seconds: 0,
              created_by: shipment.checked_in_by ?? "system",
              status_history: []
            }
          });
        }
        const existingListing = await prisma.listings.findUnique({
          where: { item_id: firstItem.item_id }
        });
        if (!existingListing) {
          await prisma.listings.create({
            data: {
              item_id: firstItem.item_id,
              title: firstItem.title ?? "Unknown",
              raw_json: {}
            }
          });
        }

        await prisma.received_units.create({
          data: {
            order_id: shipment.order_id,
            item_id: firstItem.item_id,
            condition_status: otherScan.notes?.includes("condition:") 
              ? otherScan.notes.split("condition:")[1]?.trim() ?? "good"
              : "good",
            unit_index: i + 1,
            notes: otherScan.notes,
            scanned_by_user_id: shipment.checked_in_by ?? auth.session!.user!.id as string
          }
        });
      }

      await prisma.shipments.update({
        where: { id: shipment.id },
        data: {
          scanned_units: remainingUnits,
          scan_status: scanStatus,
          is_lot: isLot,
          // Keep checked_in_at if there are still scans
          checked_in_at: firstOtherScan ? shipment.checked_in_at : null,
          checked_in_by: firstOtherScan ? shipment.checked_in_by : null
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
    message: `Scan deleted. Reversed check-in for ${affectedOrderIds.length} order(s). Dashboard counts updated.`
  });
}
