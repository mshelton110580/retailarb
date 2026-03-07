import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { z } from "zod";
import { findOrCreateCategory, computeInventoryState } from "@/lib/item-categorization";
import { extractProductAndLotInfo } from "@/lib/ai";
import type { ProductInfo } from "@/lib/ai";

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

    // On first scan, use AI to predict lot from title
    let aiLotPrediction: { isLot: boolean; itemsPerUnit: number; confidence: string } | null = null;
    let aiProductInfo: ProductInfo | null = null;
    if (!shipment.checked_in_at && !shipment.is_lot && orderItems[0]?.title) {
      try {
        const aiResult = await extractProductAndLotInfo(orderItems[0].title, orderQty);
        aiProductInfo = aiResult.product;
        if (aiResult.lot.isLot && aiResult.lot.confidence !== "low") {
          aiLotPrediction = {
            isLot: true,
            itemsPerUnit: aiResult.lot.itemsPerUnit,
            confidence: aiResult.lot.confidence
          };
          // Pre-set lot info on shipment so it's treated as a lot from the start
          shipment.is_lot = true;
          shipment.lot_size = aiResult.lot.itemsPerUnit;
          await prisma.shipments.update({
            where: { id: shipment.id },
            data: {
              is_lot: true,
              lot_size: aiResult.lot.itemsPerUnit,
              scan_status: "check_quantity"
            }
          });
        }
      } catch (err) {
        console.error("AI lot prediction failed (non-blocking):", err);
      }
    }

    // Count how many units have already been scanned for this shipment
    const currentScannedCount = await prisma.received_units.count({
      where: { order_id: shipment.order_id }
    });

    const newUnitIndex = currentScannedCount + 1;
    const newScannedCount = currentScannedCount + 1;

    // Lot detection: scans STRICTLY greater than orderQty means each purchased
    // unit contains multiple physical items. The triggering scan (qty+1) is the
    // moment we retroactively reclassify the shipment as a lot.
    const justBecameLot = !shipment.is_lot && newScannedCount > orderQty;
    const isLot = shipment.is_lot || newScannedCount > orderQty;

    // lot_size: use the greater of AI prediction and scan-based estimate.
    // AI may predict 24 on first scan; scan-based = ceil(scanned/qty).
    // As scans accumulate, scan-based catches up or exceeds AI prediction.
    const scanBasedLotSize = isLot && orderQty > 0
      ? Math.ceil(newScannedCount / orderQty)
      : null;
    const lotSize = isLot
      ? Math.max(scanBasedLotSize ?? 0, shipment.lot_size ?? 0) || null
      : (shipment.lot_size ?? null);

    // For lots all units belong to the first (and only meaningful) order item.
    // For normal multi-qty orders walk items linearly.
    let targetItemScannedSoFar = 0;
    let targetItemStartIndex = 0;
    const targetItem = (() => {
      if (isLot) return orderItems[0];
      let running = 0;
      for (const item of orderItems) {
        const prevRunning = running;
        running += item.qty;
        if (newUnitIndex <= running) {
          targetItemStartIndex = prevRunning;
          targetItemScannedSoFar = newUnitIndex - prevRunning;
          return item;
        }
      }
      return orderItems[0];
    })();

    // If this scan just triggered lot reclassification, fix all prior units:
    // point their order_item_id to the first order item (same as all lot units).
    if (justBecameLot && orderItems[0]) {
      await prisma.received_units.updateMany({
        where: { order_id: shipment.order_id },
        data: { order_item_id: orderItems[0].id }
      });
    }

    // Reopen reconciliation if this tracking number is being rescanned after
    // already being marked reviewed/overridden.
    const reopenReconciliation =
      shipment.is_lot &&
      (shipment.reconciliation_status === "reviewed" ||
        shipment.reconciliation_status === "overridden");

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
      // Reuse AI product info from lot detection if available (avoids duplicate API call)
      const categoryResult = await findOrCreateCategory(listing.gtin, listing.title, aiProductInfo);
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
            // Got a refund and kept it — parts_repair means "compensated, can scrap/part out"
            inventoryState = "parts_repair";
          } else {
            // Closed with no refund and no shipping — still needs action
            inventoryState = "to_be_returned";
          }
        } else {
          // Open return filed, not yet shipped — need to send back
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

      // scan_status: lots always stay check_quantity until reconciliation
      const scanStatus = isLot
        ? "check_quantity"
        : newScannedCount >= orderQty
          ? "complete"
          : "partial";

      // Update shipment with scan progress; reopen reconciliation if rescanned
      await prisma.shipments.update({
        where: { id: shipment.id },
        data: {
          scanned_units: newScannedCount,
          scan_status: scanStatus,
          is_lot: isLot,
          lot_size: lotSize,
          checked_in_at: shipment.checked_in_at ?? new Date(),
          checked_in_by: shipment.checked_in_by ?? auth.session!.user!.id,
          ...(reopenReconciliation ? { reconciliation_status: "pending" } : {})
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
        aiLotPrediction,
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
          qty: targetItem.qty,
          scannedForItem: isLot ? newScannedCount : targetItemScannedSoFar,
          remainingForItem: isLot ? null : targetItem.qty - targetItemScannedSoFar
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
