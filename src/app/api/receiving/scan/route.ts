import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { z } from "zod";
import { findOrCreateProduct, computeInventoryState } from "@/lib/product-matching";
import { extractProductAndLotInfo } from "@/lib/ai";
import type { ProductInfo, LotItem } from "@/lib/ai";
import type { ListingMetadata } from "@/lib/ai/product-parser";
import { getValidAccessToken } from "@/lib/ebay/token";
import { getItemByLegacyId } from "@/lib/ebay/browse";

const schema = z.object({
  tracking: z.string().min(8),
  condition_status: z.string().default("good"),
  notes: z.string().optional()
});

function last8(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-8);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|td|th)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/**
 * Extract GTIN, MPN, and Color from a listing's raw_json (Browse API data).
 */
function extractListingMetadata(rawJson: Record<string, any> | null): ListingMetadata | null {
  if (!rawJson || Object.keys(rawJson).length === 0) return null;

  const gtin = rawJson.gtin || null;
  const mpn = rawJson.mpn || null;

  // Color from localizedAspects (item specifics)
  let color: string | null = null;
  if (Array.isArray(rawJson.localizedAspects)) {
    const colorAspect = rawJson.localizedAspects.find(
      (a: any) => a.name === "Color"
    );
    if (colorAspect) color = colorAspect.value;
  }

  if (!gtin && !mpn && !color) return null;
  return { gtin, mpn, color };
}

/**
 * Get listing description and metadata for AI lot detection.
 * Checks cached raw_json first, falls back to on-demand Browse API fetch.
 */
async function getListingDetails(
  itemId: string,
  ebayAccountId: string | null
): Promise<{ description: string | null; metadata: ListingMetadata | null }> {
  // 1. Check cached raw_json
  const listing = await prisma.listings.findUnique({
    where: { item_id: itemId },
    select: { raw_json: true }
  });

  let rawJson = listing?.raw_json as Record<string, any> | null;

  // 2. On-demand Browse API fetch if no cached data
  if (!rawJson || Object.keys(rawJson).length === 0) {
    if (!ebayAccountId) return { description: null, metadata: null };

    try {
      const { token } = await getValidAccessToken(ebayAccountId);
      const browseItem = await getItemByLegacyId(token, itemId);
      if (!browseItem) return { description: null, metadata: null };

      rawJson = browseItem.raw;

      // Cache raw_json for future use (fire-and-forget)
      if (listing) {
        prisma.listings.update({
          where: { item_id: itemId },
          data: {
            raw_json: browseItem.raw,
            title: browseItem.title,
            gtin: browseItem.gtin ?? null,
            brand: browseItem.brand ?? null,
            mpn: browseItem.mpn ?? null,
          }
        }).catch(err => console.error(`Failed to cache raw_json for ${itemId}:`, err));
      }
    } catch (err) {
      console.error(`On-demand Browse API fetch failed for ${itemId}:`, err);
      return { description: null, metadata: null };
    }
  }

  const desc = rawJson?.description || rawJson?.shortDescription;
  return {
    description: desc ? stripHtml(desc) : null,
    metadata: extractListingMetadata(rawJson),
  };
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

  // === Pre-analyze all matched shipments ===
  // When multiple shipments share a tracking number (e.g. two lots in one box),
  // we need to determine lot sizes upfront and allocate each scan to ONE shipment.
  type ShipmentAnalysis = {
    match: typeof matches[0];
    shipment: NonNullable<typeof matches[0]["shipment"]>;
    orderItems: NonNullable<NonNullable<typeof matches[0]["shipment"]>["order"]>["order_items"];
    orderQty: number;
    currentScanned: number;
    capacity: number;
    aiProductInfo: ProductInfo | null;
    aiProductInfoByItem: Map<string, ProductInfo>;
    aiLotPrediction: { isLot: boolean; itemsPerUnit: number; confidence: string } | null;
    aiLotBreakdown: LotItem[] | null;
  };

  const shipmentAnalyses: ShipmentAnalysis[] = [];

  for (const match of matches) {
    const shipment = match.shipment;
    if (!shipment?.order) continue;

    const orderItems = shipment.order.order_items ?? [];
    const orderQty = orderItems.reduce((sum, item) => sum + item.qty, 0);

    // Set expected_units = orderQty on first scan if not already set
    if (shipment.expected_units === 0 && orderQty > 0) {
      await prisma.shipments.update({
        where: { id: shipment.id },
        data: { expected_units: orderQty }
      });
      shipment.expected_units = orderQty;
    }

    // Run AI lot detection for unprocessed shipments
    let aiLotPrediction: { isLot: boolean; itemsPerUnit: number; confidence: string } | null = null;
    let aiLotBreakdown: LotItem[] | null = null;
    let aiProductInfo: ProductInfo | null = null;
    const aiProductInfoByItem = new Map<string, ProductInfo>();
    if (!shipment.checked_in_at && !shipment.is_lot && orderItems[0]?.title) {
      try {
        // Get existing product names directly from DB — these are the authoritative
        // names the AI should match against (not AI-reparsed canonical names)
        const existingProducts = await prisma.products.findMany({
          select: { product_name: true }
        });
        const productNames = existingProducts.map(p => p.product_name);

        // Fetch listing details and run AI for the first item (lot detection + product ID)
        const { description, metadata: listingMetadata } = await getListingDetails(
          orderItems[0].item_id,
          shipment.order?.ebay_account_id ?? null
        );

        const aiResult = await extractProductAndLotInfo(orderItems[0].title, orderQty, description, productNames, listingMetadata);
        aiProductInfo = aiResult.product;
        aiProductInfoByItem.set(orderItems[0].item_id, aiResult.product);

        if (aiResult.lot.isLot && aiResult.lot.confidence !== "low") {
          aiLotPrediction = {
            isLot: true,
            itemsPerUnit: aiResult.lot.itemsPerUnit,
            confidence: aiResult.lot.confidence
          };
          aiLotBreakdown = aiResult.lot.itemBreakdown;
          shipment.is_lot = true;
          shipment.lot_size = aiResult.lot.itemsPerUnit;
          await prisma.shipments.update({
            where: { id: shipment.id },
            data: {
              is_lot: true,
              lot_size: aiResult.lot.itemsPerUnit,
              lot_manifest: aiResult.lot.itemBreakdown.map(i => ({ desc: i.product, qty: i.quantity })),
              scan_status: "check_quantity"
            }
          });
        }

        // For multi-item orders, run AI product ID on remaining items in parallel
        if (orderItems.length > 1 && !shipment.is_lot) {
          const remainingItems = orderItems.slice(1);
          const results = await Promise.allSettled(
            remainingItems.map(async (item) => {
              const { description: itemDesc, metadata: itemMeta } = await getListingDetails(
                item.item_id,
                shipment.order?.ebay_account_id ?? null
              );
              const itemResult = await extractProductAndLotInfo(item.title, item.qty, itemDesc, productNames, itemMeta);
              return { itemId: item.item_id, product: itemResult.product };
            })
          );
          for (const result of results) {
            if (result.status === "fulfilled") {
              aiProductInfoByItem.set(result.value.itemId, result.value.product);
            }
          }
        }
      } catch (err) {
        console.error("AI lot prediction failed (non-blocking):", err);
      }
    }

    const currentScanned = await prisma.received_units.count({
      where: { order_id: shipment.order_id }
    });

    // Capacity = total physical items expected.
    // lot_size is "items per purchase unit" from AI; multiply by orderQty for total.
    // e.g., "LOT OF 6" with qty=2 → capacity = 6 * 2 = 12
    const capacity = shipment.lot_size
      ? shipment.lot_size * orderQty
      : orderQty;

    shipmentAnalyses.push({
      match, shipment, orderItems, orderQty,
      currentScanned, capacity, aiProductInfo, aiProductInfoByItem, aiLotPrediction, aiLotBreakdown
    });
  }

  // === Select target shipment for this scan ===
  // For shared tracking numbers: allocate to the first shipment that isn't full.
  // Items are the same product so it doesn't matter which order gets which unit.
  let targetIdx = 0;
  let poolInfo: {
    isSharedTracking: boolean;
    totalCapacity: number;
    totalScanned: number;
    orders: Array<{
      orderId: string;
      title: string;
      capacity: number;
      scanned: number;
      isTarget: boolean;
    }>;
  } | null = null;

  if (shipmentAnalyses.length > 1) {
    const notFullIdx = shipmentAnalyses.findIndex(a => a.currentScanned < a.capacity);
    targetIdx = notFullIdx >= 0 ? notFullIdx : shipmentAnalyses.length - 1;

    poolInfo = {
      isSharedTracking: true,
      totalCapacity: shipmentAnalyses.reduce((s, a) => s + a.capacity, 0),
      totalScanned: shipmentAnalyses.reduce((s, a) => s + a.currentScanned, 0) + 1,
      orders: shipmentAnalyses.map((a, i) => ({
        orderId: a.shipment.order_id,
        title: a.orderItems[0]?.title ?? "Unknown",
        capacity: a.capacity,
        scanned: a.currentScanned + (i === targetIdx ? 1 : 0),
        isTarget: i === targetIdx
      }))
    };
  }

  // === Shared tracking: combined confirmation ===
  // When multiple shipments share a tracking number and ALL are first-scan
  // (no units created yet), return a combined confirmation modal so the user
  // can confirm the entire box at once instead of one shipment at a time.
  if (shipmentAnalyses.length > 1) {
    const allFirstScan = shipmentAnalyses.every(a => a.currentScanned === 0);
    const allHaveBreakdown = shipmentAnalyses.every(a => {
      const breakdown = a.aiLotBreakdown
        ?? (a.shipment.lot_manifest as Array<{ desc: string; qty: number }> | null)?.map(
          m => ({ product: m.desc, quantity: m.qty })
        );
      return (breakdown && breakdown.length > 0) || a.orderQty > 1;
    });

    if (allFirstScan && allHaveBreakdown) {
      const results: any[] = [];
      const combinedShipments: Array<{
        shipmentId: string;
        orderId: string;
        itemId: string;
        orderItemId: string;
        title: string;
        expectedUnits: number;
        itemBreakdown: LotItem[];
        isLot: boolean;
        orderItems?: Array<{ itemId: string; orderItemId: string; title: string; qty: number }>;
      }> = [];

      for (const analysis of shipmentAnalyses) {
        const { shipment, orderItems, orderQty } = analysis;
        const isLot = shipment.is_lot || orderQty > 1;

        let breakdown = analysis.aiLotBreakdown
          ?? (shipment.lot_manifest as Array<{ desc: string; qty: number }> | null)?.map(
            m => ({ product: m.desc, quantity: m.qty })
          )
          ?? null;

        // For non-lot multi-qty, build breakdown from order items using AI names
        if (!breakdown || breakdown.length === 0) {
          breakdown = orderItems.map(item => {
            const itemAi = analysis.aiProductInfoByItem.get(item.item_id);
            return {
              product: itemAi?.canonicalName ?? item.title,
              quantity: item.qty,
            };
          });
        }

        // Scale lot breakdowns by orderQty
        const scaledBreakdown = (shipment.is_lot && orderQty > 1)
          ? breakdown.map(item => ({
              ...item,
              quantity: item.quantity > 0 ? item.quantity * orderQty : 0
            }))
          : breakdown;

        const totalUnits = shipment.is_lot
          ? (shipment.lot_size ? shipment.lot_size * orderQty : scaledBreakdown.reduce((s, i) => s + i.quantity, 0))
          : orderQty;

        combinedShipments.push({
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          itemId: orderItems[0].item_id,
          orderItemId: orderItems[0].id,
          title: orderItems[0].title,
          expectedUnits: totalUnits,
          itemBreakdown: scaledBreakdown,
          isLot: shipment.is_lot,
          ...(!shipment.is_lot && orderQty > 1 ? {
            orderItems: orderItems.map(i => ({
              itemId: i.item_id,
              orderItemId: i.id,
              title: i.title,
              qty: i.qty,
            })),
          } : {}),
        });
      }

      const totalUnitsAll = combinedShipments.reduce((s, sh) => s + sh.expectedUnits, 0);

      results.push({
        orderId: combinedShipments[0].orderId,
        isLot: true,
        lotSize: null,
        scanStatus: "check_quantity",
        scannedSoFar: 0,
        expectedUnits: totalUnitsAll,
        condition: body.data.condition_status,
        lotConfirmation: {
          shipmentId: combinedShipments[0].shipmentId,
          orderId: combinedShipments[0].orderId,
          itemId: combinedShipments[0].itemId,
          orderItemId: combinedShipments[0].orderItemId,
          title: `Shared box — ${combinedShipments.length} orders`,
          totalUnits: totalUnitsAll,
          itemBreakdown: combinedShipments.flatMap(sh => sh.itemBreakdown),
          shipments: combinedShipments,
        },
        item: {
          title: combinedShipments[0].title,
          itemId: combinedShipments[0].itemId,
          qty: 1,
        },
        allItems: combinedShipments.map(sh => ({
          title: sh.title,
          qty: sh.expectedUnits,
          itemId: sh.itemId,
        })),
      });

      const message = `Shared box — ${combinedShipments.length} orders, ${totalUnitsAll} total items — confirm all`;
      return NextResponse.json({
        scan,
        resolution: resolutionState,
        matchCount: matches.length,
        message,
        results,
        poolInfo
      });
    }
  }

  // === Process only the target shipment ===
  const results: any[] = [];
  const target = shipmentAnalyses[targetIdx];

  if (target) {
    const { match, shipment, orderItems, orderQty, aiProductInfo, aiLotPrediction } = target;

    const currentScannedCount = target.currentScanned;

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

    // === Lot confirmation flow ===
    // On first scan of an AI-detected lot, return the breakdown for the
    // confirmation modal instead of creating units one at a time.
    // Also handle re-scans before confirmation: if lot_manifest exists but
    // no units have been created yet, re-serve the confirmation.
    const lotBreakdown = target.aiLotBreakdown
      ?? (shipment.lot_manifest as Array<{ desc: string; qty: number }> | null)?.map(
        m => ({ product: m.desc, quantity: m.qty })
      )
      ?? null;

    if (isLot && lotBreakdown && lotBreakdown.length > 0 && currentScannedCount === 0) {
      // Build per-lot-unit breakdown when qty > 1
      // e.g., "LOT OF 6" with qty=2 → Lot A (6 items) + Lot B (6 items)
      const scaledBreakdown: Array<LotItem & { group?: string }> = [];
      if (orderQty > 1) {
        const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for (let pu = 0; pu < orderQty; pu++) {
          const label = `Lot ${labels[pu] ?? (pu + 1)}`;
          for (const item of lotBreakdown) {
            scaledBreakdown.push({
              product: item.product,
              quantity: item.quantity > 0 ? item.quantity : 0,
              group: label,
            });
          }
        }
      } else {
        scaledBreakdown.push(...lotBreakdown);
      }
      const totalPhysicalUnits = lotSize
        ? (lotSize as number) * orderQty
        : scaledBreakdown.reduce((s, i) => s + i.quantity, 0);

      results.push({
        orderId: shipment.order_id,
        isLot: true,
        lotSize,
        scanStatus: "check_quantity",
        scannedSoFar: 0,
        expectedUnits: orderQty,
        condition: body.data.condition_status,
        lotConfirmation: {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          itemId: orderItems[0].item_id,
          orderItemId: orderItems[0].id,
          title: orderItems[0].title,
          totalUnits: totalPhysicalUnits,
          itemBreakdown: scaledBreakdown,
        },
        item: {
          title: orderItems[0].title,
          itemId: orderItems[0].item_id,
          qty: orderItems[0].qty,
        },
        allItems: orderItems.map(i => ({ title: i.title, qty: i.qty, itemId: i.item_id })),
      });
    } else if (!isLot && orderQty > 1 && currentScannedCount === 0) {
      // === Multi-qty confirmation flow ===
      // Orders with qty > 1 (not lots) get the same confirmation modal
      // so the user can set conditions per unit instead of scanning one at a time.

      // Run product matching for each order item using AI name + listing GTIN
      const breakdownWithProducts: Array<LotItem & {
        productId?: string | null;
        confidence?: string;
        requiresManualSelection?: boolean;
        suggestedProductName?: string;
      }> = [];

      for (const item of orderItems) {
        const itemAi = target.aiProductInfoByItem.get(item.item_id);
        const productName = itemAi?.canonicalName ?? item.title;

        // Get GTIN from listing for product matching
        const listing = await prisma.listings.findUnique({
          where: { item_id: item.item_id },
          select: { gtin: true, raw_json: true }
        });
        const gtin = listing?.gtin
          || (listing?.raw_json as Record<string, any>)?.gtin?.replace(/^"|"$/g, "")
          || null;

        const productResult = await findOrCreateProduct(gtin, productName, itemAi);

        breakdownWithProducts.push({
          product: productName,
          quantity: item.qty,
          productId: productResult.productId,
          confidence: productResult.confidence,
          requiresManualSelection: productResult.requiresManualSelection,
          suggestedProductName: productResult.suggestedProductName,
        });
      }

      const orderItemsInfo = orderItems.map(i => ({
        itemId: i.item_id,
        orderItemId: i.id,
        title: i.title,
        qty: i.qty,
      }));

      results.push({
        orderId: shipment.order_id,
        isLot: false,
        lotSize: null,
        scanStatus: "pending",
        scannedSoFar: 0,
        expectedUnits: orderQty,
        condition: body.data.condition_status,
        lotConfirmation: {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          itemId: orderItems[0].item_id,
          orderItemId: orderItems[0].id,
          title: orderItems[0].title,
          totalUnits: orderQty,
          itemBreakdown: breakdownWithProducts,
          isMultiQty: true,
          orderItems: orderItemsInfo,
        },
        item: {
          title: orderItems[0].title,
          itemId: orderItems[0].item_id,
          qty: orderItems[0].qty,
        },
        allItems: orderItems.map(i => ({ title: i.title, qty: i.qty, itemId: i.item_id })),
      });
    } else {
    // === Normal unit creation flow ===

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

      // Find or create product based on GTIN and title
      // Reuse AI product info from lot detection if available (avoids duplicate API call)
      const productResult = await findOrCreateProduct(listing.gtin, listing.title, aiProductInfo);
      const productId = productResult.productId;

      // Check if there's an existing return for this order/item
      const existingReturn = await prisma.returns.findFirst({
        where: {
          order_id: shipment.order_id,
          ebay_item_id: targetItem.item_id
        },
        select: {
          ebay_state: true,
          ebay_status: true,
          return_shipped_date: true,
          return_delivered_date: true,
          refund_issued_date: true,
          actual_refund: true,
          refund_amount: true,
          estimated_refund: true
        }
      });

      // Compute initial inventory state based on condition and return status
      let inventoryState = computeInventoryState(body.data.condition_status);

      // Override state if there's a return
      if (existingReturn) {
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
          // Closed return, no return delivery — keeping the item (refunded, denied, or expired)
          inventoryState = body.data.condition_status?.toLowerCase() === "damaged" ? "fair" : "parts_repair";
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
          product_id: productId,
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
        productInfo: {
          productId: productResult.productId,
          confidence: productResult.confidence,
          requiresManualSelection: productResult.requiresManualSelection,
          reason: productResult.reason,
          suggestedProductName: productResult.suggestedProductName
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
    } // end else (normal unit creation)
  } // end if (target)

  // Build response message
  const firstResult = results[0];
  let message = "";
  if (firstResult) {
    if (poolInfo) {
      // Shared tracking: show combined pool progress
      const { totalScanned, totalCapacity } = poolInfo;
      const remaining = totalCapacity - totalScanned;
      message = `Shared box — ${totalScanned} of ${totalCapacity} total units scanned`;
      if (remaining > 0) {
        message += ` (${remaining} remaining)`;
      } else {
        message += ` — All units checked in!`;
      }
    } else if (firstResult.lotConfirmation) {
      message = `Lot detected — confirm items`;
    } else if (firstResult.isLot) {
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
    results,
    poolInfo
  });
}
