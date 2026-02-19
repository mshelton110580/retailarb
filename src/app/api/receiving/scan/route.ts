import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { z } from "zod";
import { findOrCreateCategory, computeInventoryState } from "@/lib/item-categorization";

const schema = z.object({
  tracking: z.string().min(8),
  condition_status: z.string().default("good"),
  notes: z.string().optional()
});

function last8(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-8);
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const trackingInput = body.data.tracking.trim();
  const tracking_last8 = last8(trackingInput);

  // Try exact match first, then fall back to last-8 match
  let matches = await prisma.tracking_numbers.findMany({
    where: { tracking_number: trackingInput },
    include: { shipment: { include: { order: { include: { order_items: true } } } } }
  });

  if (matches.length === 0) {
    matches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: { endsWith: tracking_last8 } },
      include: { shipment: { include: { order: { include: { order_items: true } } } } }
    });
  }

  const resolutionState = matches.length > 0 ? "MATCHED" : "UNRESOLVED";

  // Create the scan record
  const scan = await prisma.receiving_scans.create({
    data: {
      tracking_last8,
      tracking_full: trackingInput,
      scanned_by_user_id: auth.session.user.id,
      resolution_state: resolutionState,
      notes: body.data.notes ?? null
    }
  });

  if (matches.length === 0) {
    return NextResponse.json({
      scan,
      resolution: "UNRESOLVED",
      matchCount: 0,
      message: "No matching tracking number found"
    });
  }

  // Process each matched shipment
  const results: any[] = [];

  for (const match of matches) {
    const shipment = match.shipment;
    if (!shipment?.order) continue;

    const orderItems = shipment.order.order_items ?? [];

    // Total qty purchased (e.g. qty=2 means 2 items/lots ordered)
    const orderQty = orderItems.reduce((sum, item) => sum + item.qty, 0);

    // Set expected_units = orderQty on first scan if not already set
    if (shipment.expected_units === 0 && orderQty > 0) {
      await prisma.shipments.update({
        where: { id: shipment.id },
        data: { expected_units: orderQty }
      });
      shipment.expected_units = orderQty;
    }

    // Count how many units have already been scanned for this shipment
    const currentScannedCount = await prisma.received_units.count({
      where: { order_id: shipment.order_id }
    });

    const newUnitIndex = currentScannedCount + 1;

    // Lot detection: once scanned > orderQty we know each "qty unit" contains
    // multiple physical items, i.e. it's a lot. The lot size is inferred as
    // scanned_units / orderQty once scanning is complete.
    // We flag is_lot as soon as scans exceed orderQty.
    const isLot = (currentScannedCount + 1) > orderQty || shipment.is_lot;

    // Determine which order item this unit belongs to.
    // For lots (scanned > orderQty), wrap the index back around so units
    // cycle through the order items repeatedly.
    const wrappedIndex = isLot
      ? ((currentScannedCount % orderQty) + 1)
      : newUnitIndex;

    let targetItem = orderItems[0];
    let runningCount = 0;
    for (const item of orderItems) {
      runningCount += item.qty;
      if (wrappedIndex <= runningCount) {
        targetItem = item;
        break;
      }
    }

    try {
      // Ensure target exists (listings FK requires it)
      const existingTarget = await prisma.targets.findUnique({ where: { item_id: targetItem.item_id } });
      if (!existingTarget) {
        await prisma.targets.create({
          data: {
            item_id: targetItem.item_id,
            type: TargetType.BIN,
            lead_seconds: 0,
            created_by: auth.session!.user!.id,
            status: TargetStatus.PURCHASED,
            status_history: [{ status: "PURCHASED", at: new Date().toISOString() }],
            ebay_account_id: shipment.order?.ebay_account_id ?? null
          }
        });
      }

      // Ensure listing exists (received_units FK requires it)
      let listing = await prisma.listings.findUnique({
        where: { item_id: targetItem.item_id },
        select: { item_id: true, title: true, gtin: true }
      });

      if (!listing) {
        listing = await prisma.listings.create({
          data: {
            item_id: targetItem.item_id,
            title: targetItem.title ?? "Unknown",
            gtin: null,
            brand: null,
            mpn: null,
            raw_json: {}
          },
          select: { item_id: true, title: true, gtin: true }
        });
      }

      // Find or create category based on GTIN and title
      const categoryResult = await findOrCreateCategory(listing.gtin, listing.title);
      const categoryId = categoryResult.categoryId;

      // Check if there's an existing return for this order/item
      const existingReturn = await prisma.returns.findFirst({
        where: {
          order_id: shipment.order_id,
          item_id: targetItem.item_id
        },
        select: {
          ebay_state: true,
          ebay_status: true,
          return_shipped_date: true,
          return_delivered_date: true,
          refund_issued_date: true,
          actual_refund: true
        }
      });

      // Compute initial inventory state based on condition and return status
      let inventoryState = computeInventoryState(body.data.condition_status);

      // Override state if there's a return
      if (existingReturn) {
        const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
        const isBadCondition = !goodConditions.has(body.data.condition_status?.toLowerCase() ?? "");
        const isClosed =
          existingReturn.ebay_state === "CLOSED" ||
          existingReturn.ebay_status === "CLOSED" ||
          existingReturn.ebay_state === "REFUND_ISSUED" ||
          existingReturn.ebay_state === "RETURN_CLOSED" ||
          existingReturn.ebay_status === "REFUND_ISSUED" ||
          existingReturn.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";

        if (existingReturn.return_shipped_date || existingReturn.return_delivered_date) {
          // Item physically shipped or delivered back to seller
          inventoryState = "returned";
        } else if (isClosed) {
          // Closed return, no return tracking — we kept the item
          if (existingReturn.refund_issued_date || existingReturn.actual_refund) {
            inventoryState = isBadCondition ? "parts_repair" : "on_hand";
          }
          // Closed with no refund and no shipping — leave as condition-based state
        } else {
          // Open return, not yet shipped — need to send back
          inventoryState = "to_be_returned";
        }
      }

      // Create the received_unit for this scan
      const unit = await prisma.received_units.create({
        data: {
          item_id: targetItem.item_id,
          order_id: shipment.order_id,
          order_item_id: targetItem.id,
          unit_index: newUnitIndex,
          condition_status: body.data.condition_status,
          inventory_state: inventoryState,
          category_id: categoryId,
          scanned_by_user_id: auth.session.user.id,
          notes: body.data.notes ?? null
        }
      });

      const newScannedCount = currentScannedCount + 1;

      // Infer lot_size once we have more scans than orderQty
      // lot_size = scanned / orderQty (integer division, only update when evenly divisible)
      let lotSize: number | null = shipment.lot_size ?? null;
      if (isLot && orderQty > 0 && newScannedCount % orderQty === 0) {
        lotSize = newScannedCount / orderQty;
      }

      // scan_status: lots always stay check_quantity until reconciliation
      let scanStatus: string;
      if (isLot) {
        scanStatus = "check_quantity";
      } else if (newScannedCount >= orderQty) {
        scanStatus = "complete";
      } else {
        scanStatus = "partial";
      }

      // Update shipment with scan progress
      await prisma.shipments.update({
        where: { id: shipment.id },
        data: {
          scanned_units: newScannedCount,
          scan_status: scanStatus,
          is_lot: isLot,
          lot_size: lotSize,
          checked_in_at: shipment.checked_in_at ?? new Date(),
          checked_in_by: shipment.checked_in_by ?? auth.session!.user!.id
        }
      });

      const remaining = isLot ? null : Math.max(0, orderQty - newScannedCount);

      results.push({
        orderId: shipment.order_id,
        unitIndex: newUnitIndex,
        unitId: unit.id,
        expectedUnits: orderQty,
        scannedSoFar: newScannedCount,
        lotSize,
        remaining,
        scanStatus,
        isLot,
        condition: body.data.condition_status,
        categoryInfo: {
          categoryId: categoryResult.categoryId,
          confidence: categoryResult.confidence,
          requiresManualSelection: categoryResult.requiresManualSelection,
          reason: categoryResult.reason,
          suggestedCategoryName: categoryResult.suggestedCategoryName
        },
        item: {
          title: targetItem.title,
          itemId: targetItem.item_id,
          qty: targetItem.qty
        },
        allItems: orderItems.map((i) => ({
          title: i.title,
          qty: i.qty,
          itemId: i.item_id
        }))
      });

    } catch (err: any) {
      console.error(`Failed to create received_unit for order ${shipment.order_id}:`, err.message);
      results.push({
        orderId: shipment.order_id,
        error: err.message
      });
    }
  }

  // Build response message
  const firstResult = results[0];
  let message = "";
  if (firstResult) {
    if (firstResult.isLot) {
      const lotDesc = firstResult.lotSize
        ? `${firstResult.scannedSoFar} scanned (${firstResult.lotSize} per lot × qty ${firstResult.expectedUnits})`
        : `${firstResult.scannedSoFar} scanned (qty: ${firstResult.expectedUnits})`;
      message = `Lot — ${lotDesc}. Needs reconciliation.`;
    } else if (firstResult.scanStatus === "complete") {
      message = `Unit ${firstResult.unitIndex} of ${firstResult.expectedUnits} — All units checked in!`;
    } else if (firstResult.scanStatus === "partial") {
      message = `Unit ${firstResult.unitIndex} of ${firstResult.expectedUnits} checked in — ${firstResult.remaining} remaining`;
    }
  }

  return NextResponse.json({
    scan,
    resolution: resolutionState,
    matchCount: matches.length,
    message,
    results
  });
}
