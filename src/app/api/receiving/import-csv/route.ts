import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { findOrCreateProduct, computeInventoryState, generateProductName } from "@/lib/product-matching";
import { onProductCreated } from "@/lib/ai";

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

function lastN(value: string, n: number) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-n);
}

export interface ImportRow {
  timestamp: string;        // raw timestamp string
  tracking: string;         // full tracking number
  quantity: number;         // number of units to create
  condition_status: string; // good / pressure mark / etc.
  condition_notes?: string; // extra detail when condition started with "good ..."
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

  // Track order IDs processed in this batch so repeated tracking = lot (never skip within same import)
  const processedOrderIds = new Set<string>();

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
    const trackingDigits = trackingInput.replace(/\D/g, "");
    const qty = Math.max(1, Math.floor(Number(row.quantity) || 1));
    const conditionStatus = row.condition_status?.trim() || "good";
    const conditionNotes = row.condition_notes?.trim() || null;
    const scannedAt = parseTimestamp(row.timestamp) ?? new Date();
    const inventoryId = row.inventory_id?.trim() || null; // retained for potential future use but not stored in notes
    // Only store condition_notes in the notes field; inventory_id is not needed there
    const unitNotes = conditionNotes || null;

    // Find matching shipment via tracking number:
    // 1. Exact match
    // 2. Last-12-digit suffix match (more specific than last-8 to avoid false positives)
    // Skip suffix fallback if the input has fewer than 12 digits (too ambiguous)
    let matches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: trackingInput },
      include: { shipment: { include: { order: { include: { order_items: true } } } } }
    });

    if (matches.length === 0 && trackingDigits.length >= 12) {
      const last12 = lastN(trackingInput, 12);
      matches = await prisma.tracking_numbers.findMany({
        where: { tracking_number: { endsWith: last12 } },
        include: { shipment: { include: { order: { include: { order_items: true } } } } }
      });
      // If still multiple matches, the suffix is too ambiguous — skip to avoid wrong assignments
      if (matches.length > 1) {
        results.push({ row: rowNum, tracking: trackingInput, status: "skipped", message: `Ambiguous tracking suffix — ${matches.length} possible matches` });
        totalSkipped++;
        continue;
      }
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

      // Skip only if this order was already fully checked in by a PREVIOUS import/scan run,
      // AND it has not appeared in the current batch (which would mean it's a lot),
      // AND it is not already flagged as a lot (lots always allow more units).
      // processedOrderIds tracks what we've already touched this run — if it's in there,
      // the same tracking appeared again in the sheet → lot, always create more units.
      const seenThisRun = processedOrderIds.has(shipment.order_id);
      const isAlreadyLot = shipment.is_lot;
      const checkedInPreviously = !seenThisRun && !isAlreadyLot && shipment.checked_in_at != null && existingCount >= shipment.expected_units && existingCount > 0;
      const isExactRepeat = checkedInPreviously;

      if (isExactRepeat) {
        // Mark as seen so subsequent rows with the same tracking are treated as a lot
        processedOrderIds.add(shipment.order_id);
        // Same tracking, same qty — check if we should update condition/notes
        const isNonDefaultCondition = conditionStatus && conditionStatus.toLowerCase() !== "good";
        if (isNonDefaultCondition || conditionNotes) {
          // Update condition and/or notes on existing units that still have default "good" condition
          const newInventoryState = isNonDefaultCondition ? computeInventoryState(conditionStatus) : undefined;
          await prisma.received_units.updateMany({
            where: { order_id: shipment.order_id, condition_status: "good" },
            data: {
              ...(isNonDefaultCondition ? { condition_status: conditionStatus, inventory_state: newInventoryState } : {}),
              ...(conditionNotes ? { notes: unitNotes } : {})
            }
          });
          const msg = isNonDefaultCondition
            ? `Updated condition to "${conditionStatus}" on existing unit(s)`
            : `Updated notes on existing unit(s)`;
          results.push({ row: rowNum, tracking: trackingInput, status: "imported", message: msg, unitsCreated: 0 });
          totalImported++;
        } else {
          results.push({ row: rowNum, tracking: trackingInput, status: "skipped", message: `Already checked in (${existingCount} units exist)` });
          totalSkipped++;
        }
        continue;
      }
      // If same tracking appears again with additional units, fall through to create them (lot scenario)

      try {
        // Create received_units for each unit in this row's quantity
        for (let u = 0; u < qty; u++) {
          const unitIndex = existingCount + u + 1;

          // Determine which order item this unit belongs to.
          // If shipment is already a lot, or this unit exceeds expected qty, it's a lot unit → use first item.
          // Otherwise walk linearly through order items.
          let targetItem = orderItems[0];
          if (!isAlreadyLot && unitIndex <= shipment.expected_units) {
            let runningCount = 0;
            for (const item of orderItems) {
              runningCount += item.qty;
              if (unitIndex <= runningCount) { targetItem = item; break; }
            }
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

          // Find or create product.
          // For imports we never have an interactive prompt, so if the detection logic
          // wants manual selection but has a suggested name, we auto-create that product.
          // If there's a best-match (any confidence), we use it rather than leaving null.
          let productResult = await findOrCreateProduct(listing.gtin, listing.title);
          if (productResult.productId === null && productResult.requiresManualSelection) {
            // Auto-create from the suggested name (or derive one fresh)
            const suggestedName = productResult.suggestedProductName ?? await generateProductName(listing.title ?? "");
            if (suggestedName) {
              // Check if a product with this name already exists (race-safe)
              const existing = await prisma.products.findFirst({
                where: { product_name: { equals: suggestedName, mode: "insensitive" } },
                select: { id: true }
              });
              if (existing) {
                productResult = { productId: existing.id, confidence: "medium", requiresManualSelection: false, reason: "Matched existing product by name" };
              } else {
                const created = await prisma.products.create({
                  data: { product_name: suggestedName, product_keywords: [] }
                });
                await onProductCreated(created.id, suggestedName);
                productResult = { productId: created.id, confidence: "low", requiresManualSelection: false, reason: "Auto-created from suggested name during import" };
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
            const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
            const isBadCondition = !goodConditions.has(conditionStatus?.toLowerCase() ?? "");
            const isClosed =
              existingReturn.ebay_state === "CLOSED" || existingReturn.ebay_status === "CLOSED" ||
              existingReturn.ebay_state === "REFUND_ISSUED" || existingReturn.ebay_state === "RETURN_CLOSED" ||
              existingReturn.ebay_status === "REFUND_ISSUED" || existingReturn.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";

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

          await prisma.received_units.create({
            data: {
              item_id: targetItem.item_id,
              order_id: shipment.order_id,
              order_item_id: targetItem.id,
              unit_index: unitIndex,
              condition_status: conditionStatus,
              inventory_state: inventoryState,
              product_id: productResult.productId,
              scanned_by_user_id: auth.session!.user!.id,
              received_at: scannedAt,
              notes: unitNotes
            }
          });

          unitsCreated++;
        }

        // Update shipment check-in state
        const newScannedCount = existingCount + unitsCreated;
        const orderQty = orderItems.reduce((sum, item) => sum + item.qty, 0);
        // A lot is any shipment where the final scanned count exceeds the purchased qty
        const isLot = newScannedCount > shipment.expected_units;
        const scanStatus = isLot ? "check_quantity" : newScannedCount >= shipment.expected_units ? "complete" : "partial";

        // lot_size = ceil(scanned / qty) — best estimate of units per lot
        const lotSize = isLot && orderQty > 0
          ? Math.ceil(newScannedCount / orderQty)
          : (shipment.lot_size ?? null);

        // If this import just triggered lot reclassification, retroactively point all prior
        // units' order_item_id to the first order item (consistent with lot scan logic).
        const justBecameLot = !shipment.is_lot && isLot;
        if (justBecameLot && orderItems[0]) {
          await prisma.received_units.updateMany({
            where: { order_id: shipment.order_id },
            data: { order_item_id: orderItems[0].id }
          });
        }

        await prisma.shipments.update({
          where: { id: shipment.id },
          data: {
            scanned_units: newScannedCount,
            scan_status: scanStatus,
            is_lot: isLot || shipment.is_lot,
            lot_size: lotSize,
            checked_in_at: shipment.checked_in_at ?? scannedAt,
            checked_in_by: shipment.checked_in_by ?? auth.session!.user!.id
          }
        });

        processedOrderIds.add(shipment.order_id);
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
