import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { findOrCreateCategory, computeInventoryState } from "@/lib/item-categorization";

// Parse a Google Sheets timestamp like "2023/07/01 12:05.45" or "7/1/2023 12:05:45"
function parseTimestamp(raw: string): Date | null {
  if (!raw?.trim()) return null;
  // Normalise separators: replace "/" with "-" for date part, "." with ":" for time
  const normalised = raw.trim().replace(/\./g, ":");
  const d = new Date(normalised);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function last8(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-8);
}

export interface ImportRow {
  timestamp: string;        // raw timestamp string
  tracking: string;         // full tracking number
  quantity: number;         // number of units to create
  condition_status: string; // good / pressure mark / etc.
  inventory_id?: string;    // optional Inventory ID (stored in notes)
}

export interface ImportResult {
  row: number;
  tracking: string;
  status: "imported" | "skipped" | "error";
  message: string;
  unitsCreated?: number;
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let rows: ImportRow[];
  try {
    const body = await req.json();
    rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const results: ImportResult[] = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row.tracking?.trim()) {
      results.push({ row: rowNum, tracking: "", status: "skipped", message: "Empty tracking number" });
      totalSkipped++;
      continue;
    }

    const trackingInput = row.tracking.trim();
    const tracking_last8 = last8(trackingInput);
    const qty = Math.max(1, Math.floor(Number(row.quantity) || 1));
    const conditionStatus = row.condition_status?.trim() || "good";
    const scannedAt = parseTimestamp(row.timestamp) ?? new Date();
    const inventoryId = row.inventory_id?.trim() || null;

    // Find matching shipment via tracking number (exact then last-8)
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

    if (matches.length === 0) {
      results.push({ row: rowNum, tracking: trackingInput, status: "skipped", message: "No matching tracking number in database" });
      totalSkipped++;
      continue;
    }

    let unitsCreated = 0;
    let rowError: string | null = null;

    for (const match of matches) {
      const shipment = match.shipment;
      if (!shipment?.order) continue;

      const orderItems = shipment.order.order_items ?? [];
      if (orderItems.length === 0) continue;

      // Set expected_units if not yet set
      const expectedUnits = orderItems.reduce((sum, item) => sum + item.qty, 0);
      if (shipment.expected_units === 0 && expectedUnits > 0) {
        await prisma.shipments.update({
          where: { id: shipment.id },
          data: { expected_units: expectedUnits }
        });
        shipment.expected_units = expectedUnits;
      }

      // Check how many units already exist for this shipment
      const existingCount = await prisma.received_units.count({
        where: { order_id: shipment.order_id }
      });

      // Skip if already fully checked in with same or more units
      if (existingCount >= qty && existingCount >= shipment.expected_units && shipment.checked_in_at) {
        results.push({ row: rowNum, tracking: trackingInput, status: "skipped", message: `Already checked in (${existingCount} units exist)` });
        totalSkipped++;
        continue;
      }

      try {
        // Create received_units for each unit in this row's quantity
        for (let u = 0; u < qty; u++) {
          const unitIndex = existingCount + u + 1;

          // Determine which order item this unit belongs to
          let targetItem = orderItems[0];
          let runningCount = 0;
          for (const item of orderItems) {
            runningCount += item.qty;
            if (unitIndex <= runningCount) { targetItem = item; break; }
          }

          // Ensure target exists
          const existingTarget = await prisma.targets.findUnique({ where: { item_id: targetItem.item_id } });
          if (!existingTarget) {
            await prisma.targets.create({
              data: {
                item_id: targetItem.item_id,
                type: TargetType.BIN,
                lead_seconds: 0,
                created_by: auth.session!.user!.id,
                status: TargetStatus.PURCHASED,
                status_history: [{ status: "PURCHASED", at: scannedAt.toISOString() }],
                ebay_account_id: shipment.order?.ebay_account_id ?? null
              }
            });
          }

          // Ensure listing exists
          let listing = await prisma.listings.findUnique({
            where: { item_id: targetItem.item_id },
            select: { item_id: true, title: true, gtin: true }
          });
          if (!listing) {
            listing = await prisma.listings.create({
              data: {
                item_id: targetItem.item_id,
                title: targetItem.title ?? "Unknown",
                gtin: null, brand: null, mpn: null, raw_json: {}
              },
              select: { item_id: true, title: true, gtin: true }
            });
          }

          // Find or create category
          const categoryResult = await findOrCreateCategory(listing.gtin, listing.title);

          // Compute inventory state
          const existingReturn = await prisma.returns.findFirst({
            where: { order_id: shipment.order_id, item_id: targetItem.item_id },
            select: { ebay_state: true, ebay_status: true, return_shipped_date: true, return_delivered_date: true, refund_issued_date: true, actual_refund: true }
          });

          let inventoryState = computeInventoryState(conditionStatus);
          if (existingReturn) {
            const isClosed =
              existingReturn.ebay_state === "CLOSED" || existingReturn.ebay_status === "CLOSED" ||
              existingReturn.ebay_state === "REFUND_ISSUED" || existingReturn.ebay_state === "RETURN_CLOSED" ||
              existingReturn.ebay_status === "REFUND_ISSUED" || existingReturn.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";
            if (isClosed) {
              inventoryState = (existingReturn.return_delivered_date || existingReturn.return_shipped_date) ? "returned" : "parts_repair";
            } else if ((existingReturn.refund_issued_date || existingReturn.actual_refund) && !existingReturn.return_shipped_date) {
              inventoryState = "parts_repair";
            } else {
              inventoryState = "to_be_returned";
            }
          }

          await prisma.received_units.create({
            data: {
              item_id: targetItem.item_id,
              order_id: shipment.order_id,
              order_item_id: targetItem.id,
              unit_index: unitIndex,
              condition_status: conditionStatus,
              inventory_state: inventoryState,
              category_id: categoryResult.categoryId,
              scanned_by_user_id: auth.session!.user!.id,
              received_at: scannedAt,
              notes: inventoryId ?? null
            }
          });

          unitsCreated++;
        }

        // Update shipment check-in state
        const newScannedCount = existingCount + unitsCreated;
        const isLot = shipment.expected_units === 1 && newScannedCount > 1;
        const scanStatus = isLot ? "check_quantity" : newScannedCount >= shipment.expected_units ? "complete" : "partial";

        await prisma.shipments.update({
          where: { id: shipment.id },
          data: {
            scanned_units: newScannedCount,
            scan_status: scanStatus,
            is_lot: isLot || shipment.is_lot,
            checked_in_at: shipment.checked_in_at ?? scannedAt,
            checked_in_by: shipment.checked_in_by ?? auth.session!.user!.id
          }
        });

        totalImported++;
        results.push({ row: rowNum, tracking: trackingInput, status: "imported", message: `Created ${unitsCreated} unit(s)`, unitsCreated });

      } catch (err: any) {
        rowError = err.message;
        totalErrors++;
        results.push({ row: rowNum, tracking: trackingInput, status: "error", message: err.message });
      }
    }

    if (rowError === null && unitsCreated === 0 && matches.length > 0) {
      // All matches were already checked in — already pushed skipped above
    }
  }

  return NextResponse.json({
    ok: true,
    summary: { imported: totalImported, skipped: totalSkipped, errors: totalErrors, total: rows.length },
    results
  });
}
