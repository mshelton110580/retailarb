import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { z } from "zod";
import { findOrCreateCategory, computeInventoryState } from "@/lib/item-categorization";

const unitSchema = z.object({
  product: z.string(),
  condition: z.string(),
  notes: z.string().optional(),
});

const orderItemSchema = z.object({
  itemId: z.string(),
  orderItemId: z.string(),
  title: z.string(),
  qty: z.number(),
});

const schema = z.object({
  shipmentId: z.string(),
  orderId: z.string(),
  itemId: z.string(),
  orderItemId: z.string(),
  units: z.array(unitSchema).min(1),
  isMultiQty: z.boolean().optional(),
  orderItems: z.array(orderItemSchema).optional(),
});

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload", details: body.error.issues }, { status: 400 });
  }

  const { shipmentId, orderId, itemId, orderItemId, units, isMultiQty, orderItems: multiQtyItems } = body.data;

  // Verify shipment exists and belongs to this order
  const shipment = await prisma.shipments.findUnique({
    where: { id: shipmentId },
    include: { order: { select: { ebay_account_id: true } } }
  });

  if (!shipment || shipment.order_id !== orderId) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Count any units already created (e.g. from accidental re-scans before confirmation)
  const existingCount = await prisma.received_units.count({
    where: { order_id: orderId }
  });

  const unitsToCreate = units.length;
  const startIndex = existingCount + 1;

  // For multi-item orders, build a map of product name → order item info
  // so each unit can be assigned to its correct order_item_id and item_id.
  const productToOrderItem = new Map<string, { itemId: string; orderItemId: string }>();
  if (isMultiQty && multiQtyItems && multiQtyItems.length > 0) {
    for (const oi of multiQtyItems) {
      // Map by title (product name from breakdown matches order item title)
      productToOrderItem.set(oi.title, { itemId: oi.itemId, orderItemId: oi.orderItemId });
    }
  }

  // Collect all distinct item IDs that need targets/listings
  const allItemIds = isMultiQty && multiQtyItems
    ? [...new Set(multiQtyItems.map(oi => oi.itemId))]
    : [itemId];

  // Ensure targets and listings exist for all item IDs
  for (const iid of allItemIds) {
    const existingTarget = await prisma.targets.findUnique({ where: { item_id: iid } });
    if (!existingTarget) {
      await prisma.targets.create({
        data: {
          item_id: iid,
          type: TargetType.BIN,
          lead_seconds: 0,
          created_by: auth.session.user.id,
          status: TargetStatus.PURCHASED,
          status_history: [{ status: "PURCHASED", at: new Date().toISOString() }],
          ebay_account_id: shipment.order?.ebay_account_id ?? null
        }
      });
    }

    const existingListing = await prisma.listings.findUnique({
      where: { item_id: iid },
      select: { item_id: true }
    });

    if (!existingListing) {
      const matchingItem = multiQtyItems?.find(oi => oi.itemId === iid);
      await prisma.listings.create({
        data: {
          item_id: iid,
          title: matchingItem?.title ?? units[0]?.product ?? "Unknown",
          gtin: null,
          brand: null,
          mpn: null,
          raw_json: {}
        }
      });
    }
  }

  // For category lookups, use the first item's listing info
  const listing = await prisma.listings.findUnique({
    where: { item_id: itemId },
    select: { item_id: true, title: true, gtin: true }
  });

  // Find/create categories for each distinct product
  // First try direct name matching against existing categories (product names
  // from the AI breakdown are already clean), then fall back to full pipeline.
  const categoryCache = new Map<string, string | null>();
  const distinctProducts = [...new Set(units.map(u => u.product))];

  const allCategories = await prisma.item_categories.findMany({
    select: { id: true, category_name: true }
  });

  for (const product of distinctProducts) {
    const normProduct = product.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Try exact name match first (case-insensitive, ignoring punctuation)
    const exactMatch = allCategories.find(
      cat => cat.category_name.toLowerCase().replace(/[^a-z0-9]/g, "") === normProduct
    );

    if (exactMatch) {
      categoryCache.set(product, exactMatch.id);
      continue;
    }

    // Try best prefix match — pick the category whose normalized name shares
    // the longest common prefix with the product name.
    // e.g., "ti83plussilveredition" prefers "ti83plussilver" (13) over "ti83plus" (8)
    let bestDirectMatch: { id: string; overlap: number } | null = null;
    for (const cat of allCategories) {
      const normCat = cat.category_name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normProduct.startsWith(normCat) || normCat.startsWith(normProduct)) {
        // Overlap = length of the shorter string (the shared prefix)
        const overlap = Math.min(normProduct.length, normCat.length);
        if (!bestDirectMatch || overlap > bestDirectMatch.overlap) {
          bestDirectMatch = { id: cat.id, overlap };
        }
      }
    }

    if (bestDirectMatch && bestDirectMatch.overlap >= 8) {
      categoryCache.set(product, bestDirectMatch.id);
      continue;
    }

    // Fall back to full AI-powered pipeline
    const result = await findOrCreateCategory(null, product);
    if (!result.requiresManualSelection && result.categoryId) {
      categoryCache.set(product, result.categoryId);
    } else {
      categoryCache.set(product, null);
    }
  }

  // Check for existing returns (check all item IDs for multi-item orders)
  const returnsByItemId = new Map<string, {
    ebay_state: string | null;
    ebay_status: string | null;
    return_shipped_date: Date | null;
    return_delivered_date: Date | null;
    refund_issued_date: Date | null;
    actual_refund: any;
  }>();

  for (const iid of allItemIds) {
    const existingReturn = await prisma.returns.findFirst({
      where: { order_id: orderId, item_id: iid },
      select: {
        ebay_state: true,
        ebay_status: true,
        return_shipped_date: true,
        return_delivered_date: true,
        refund_issued_date: true,
        actual_refund: true
      }
    });
    if (existingReturn) returnsByItemId.set(iid, existingReturn);
  }

  // Create all units
  const createdUnits: Array<{ id: string; unitIndex: number; condition: string; product: string; categoryId: string | null }> = [];

  // For multi-qty multi-item orders, track how many units of each product
  // have been created so we can walk through order items linearly.
  const productUnitCounts = new Map<string, number>();

  for (let i = 0; i < unitsToCreate; i++) {
    const unit = units[i];
    const unitIndex = startIndex + i;
    const categoryId = categoryCache.get(unit.product) ?? null;

    // Resolve the correct item_id and order_item_id for this unit
    let unitItemId = itemId;
    let unitOrderItemId = orderItemId;

    if (isMultiQty && productToOrderItem.size > 0) {
      // Try exact match by product name → order item title
      const match = productToOrderItem.get(unit.product);
      if (match) {
        unitItemId = match.itemId;
        unitOrderItemId = match.orderItemId;
      }
    }

    // Compute inventory state based on condition + return status
    let inventoryState = computeInventoryState(unit.condition);

    const existingReturn = returnsByItemId.get(unitItemId);
    if (existingReturn) {
      const isClosed =
        existingReturn.ebay_state === "CLOSED" ||
        existingReturn.ebay_status === "CLOSED" ||
        existingReturn.ebay_state === "REFUND_ISSUED" ||
        existingReturn.ebay_state === "RETURN_CLOSED" ||
        existingReturn.ebay_status === "REFUND_ISSUED" ||
        existingReturn.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";

      if (existingReturn.return_shipped_date || existingReturn.return_delivered_date) {
        inventoryState = "returned";
      } else if (isClosed) {
        if (existingReturn.refund_issued_date || existingReturn.actual_refund) {
          inventoryState = "parts_repair";
        } else {
          inventoryState = "to_be_returned";
        }
      } else {
        inventoryState = "to_be_returned";
      }
    }

    const created = await prisma.received_units.create({
      data: {
        item_id: unitItemId,
        order_id: orderId,
        order_item_id: unitOrderItemId,
        unit_index: unitIndex,
        condition_status: unit.condition,
        inventory_state: inventoryState,
        category_id: categoryId,
        scanned_by_user_id: auth.session.user.id,
        notes: unit.notes ?? null
      }
    });

    createdUnits.push({
      id: created.id,
      unitIndex,
      condition: unit.condition,
      product: unit.product,
      categoryId
    });
  }

  // Update shipment
  const totalScanned = existingCount + unitsToCreate;
  if (isMultiQty) {
    // Multi-qty order: mark complete, not a lot
    await prisma.shipments.update({
      where: { id: shipmentId },
      data: {
        scanned_units: totalScanned,
        scan_status: "complete",
        checked_in_at: shipment.checked_in_at ?? new Date(),
        checked_in_by: shipment.checked_in_by ?? auth.session.user.id,
      }
    });
  } else {
    // Lot: mark as lot with lot_size
    await prisma.shipments.update({
      where: { id: shipmentId },
      data: {
        scanned_units: totalScanned,
        scan_status: "check_quantity",
        is_lot: true,
        lot_size: unitsToCreate,
        checked_in_at: shipment.checked_in_at ?? new Date(),
        checked_in_by: shipment.checked_in_by ?? auth.session.user.id,
      }
    });
  }

  return NextResponse.json({
    message: `${unitsToCreate} units created`,
    unitsCreated: unitsToCreate,
    totalScanned,
    units: createdUnits
  });
}
