import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { findOrCreateCategory, computeInventoryState, generateCategoryName } from "@/lib/item-categorization";

// Parse a Google Sheets timestamp in various formats:
//   "2023/07/01 12:05.45"  "7/1/2023 12:05:45"  "2/18/2026 14:05:45"  "2026-02-18T14:05:45"
function parseTimestamp(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.replace(/^\uFEFF/, "").trim();

  // Try native parse first (handles ISO and many locale formats)
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1;

  // Replace dots with colons in time part (Google Sheets quirk: "12:05.45" → "12:05:45")
  const dotFixed = s.replace(/(\d{1,2}:\d{2})\.(\d{2})/, "$1:$2");
  const d2 = new Date(dotFixed);
  if (!isNaN(d2.getTime())) return d2;

  // Handle M/D/YYYY H:MM:SS or MM/DD/YYYY H:MM:SS
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (m) {
    const d3 = new Date(`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}T${m[4]}`);
    if (!isNaN(d3.getTime())) return d3;
  }

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

    // Strip null bytes and control characters that would cause PostgreSQL UTF-8 errors
    const trackingInput = row.tracking.replace(/\0/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (!trackingInput) {
      results.push({ row: rowNum, tracking: row.tracking, status: "skipped", message: "Tracking number contains only invalid characters (possible misscan)" });
      totalSkipped++;
      continue;
    }
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

          // Find or create category.
          // For imports we never have an interactive prompt, so if the detection logic
          // wants manual selection but has a suggested name, we auto-create that category.
          // If there's a best-match (any confidence), we use it rather than leaving null.
          let categoryResult = await findOrCreateCategory(listing.gtin, listing.title);
          if (categoryResult.categoryId === null && categoryResult.requiresManualSelection) {
            // Auto-create from the suggested name (or derive one fresh)
            const suggestedName = categoryResult.suggestedCategoryName ?? generateCategoryName(listing.title ?? "");
            if (suggestedName) {
              // Check if a category with this name already exists (race-safe)
              const existing = await prisma.item_categories.findFirst({
                where: { category_name: { equals: suggestedName, mode: "insensitive" } },
                select: { id: true }
              });
              if (existing) {
                categoryResult = { categoryId: existing.id, confidence: "medium", requiresManualSelection: false, reason: "Matched existing category by name" };
              } else {
                const created = await prisma.item_categories.create({
                  data: { category_name: suggestedName, category_keywords: [] }
                });
                categoryResult = { categoryId: created.id, confidence: "low", requiresManualSelection: false, reason: "Auto-created from suggested name during import" };
              }
            }
          }

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
