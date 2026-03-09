import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

// GET /api/reconciliation/[shipmentId]
// Returns full lot details for reconciliation UI
export async function GET(
  req: Request,
  { params }: { params: { shipmentId: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const shipment = await prisma.shipments.findUnique({
    where: { id: params.shipmentId },
    include: {
      order: {
        include: {
          order_items: true,
        },
      },
      tracking_numbers: { select: { tracking_number: true, carrier: true } },
    },
  });

  if (!shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });

  const units = await prisma.received_units.findMany({
    where: { order_id: shipment.order_id },
    orderBy: { unit_index: "asc" },
    include: {
      listing: { select: { title: true } },
      order_item: { select: { title: true, qty: true } },
      product: { select: { id: true, product_name: true } },
      images: {
        orderBy: { created_at: "asc" },
        select: { id: true, created_at: true },
      },
    },
  });

  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

  const orderQty = shipment.order.order_items.reduce((s, i) => s + i.qty, 0);
  // lot_size: use stored value, or infer via ceil(scanned/qty)
  const lotSize = shipment.lot_size ??
    (shipment.is_lot && orderQty > 0 ? Math.ceil(shipment.scanned_units / orderQty) : null);

  // Missing units: if scanned doesn't fill all lots evenly
  const expectedTotal = lotSize && orderQty ? lotSize * orderQty : null;
  const missingUnits = expectedTotal ? expectedTotal - shipment.scanned_units : 0;

  // Mixed lot detection: multiple distinct non-null products among scanned units
  // OR lot_manifest (from title parsing) indicates multiple item types
  const nonNullProductIds = new Set(units.map((u) => u.product_id).filter(Boolean));
  const manifestMixed = Array.isArray(shipment.lot_manifest) && (shipment.lot_manifest as any[]).length > 1;
  const isMixedLot = nonNullProductIds.size > 1 || manifestMixed;

  return NextResponse.json({
    shipment: {
      id: shipment.id,
      orderId: shipment.order_id,
      orderQty,
      scannedUnits: shipment.scanned_units,
      expectedUnits: shipment.expected_units,
      isLot: shipment.is_lot,
      lotSize,
      expectedTotal,
      missingUnits,
      isMixedLot,
      reconciliationStatus: shipment.reconciliation_status,
      scanStatus: shipment.scan_status,
      tracking: shipment.tracking_numbers,
      items: shipment.order.order_items.map((i) => ({
        id: i.id,
        itemId: i.item_id,
        title: i.title,
        qty: i.qty,
        price: i.transaction_price,
      })),
    },
    units: units.map((u) => ({
      id: u.id,
      unitIndex: u.unit_index,
      title: u.listing?.title ?? u.order_item?.title ?? "Unknown",
      condition: u.condition_status,
      inventoryState: u.inventory_state,
      notes: u.notes,
      product: u.product ? { id: u.product.id, name: u.product.product_name } : null,
      isNonGood: !goodConditions.has(u.condition_status?.toLowerCase() ?? ""),
      images: u.images.map((img) => ({
        id: img.id,
        url: `/api/images/${img.id}`,
        createdAt: img.created_at,
      })),
      imageCount: u.images.length,
      needsImages: !goodConditions.has(u.condition_status?.toLowerCase() ?? "") && u.images.length === 0,
    })),
  });
}

const patchSchema = z.object({
  action: z.enum(["mark_reviewed", "override_reviewed"]),
  unitUpdates: z
    .array(
      z.object({
        unitId: z.string(),
        condition: z.string().optional(),
        inventoryState: z.string().optional(),
        productId: z.string().nullable().optional(),
        notes: z.string().optional(),
      })
    )
    .optional(),
});

// PATCH /api/reconciliation/[shipmentId]
// Mark shipment as reviewed (or override), optionally apply unit edits
export async function PATCH(
  req: Request,
  { params }: { params: { shipmentId: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { action, unitUpdates } = body.data;

  // Apply any unit-level updates first
  if (unitUpdates?.length) {
    for (const update of unitUpdates) {
      const data: any = {};
      if (update.condition !== undefined) data.condition_status = update.condition;
      if (update.inventoryState !== undefined) data.inventory_state = update.inventoryState;
      if (update.productId !== undefined) data.product_id = update.productId;
      if (update.notes !== undefined) data.notes = update.notes;
      if (Object.keys(data).length > 0) {
        await prisma.received_units.update({ where: { id: update.unitId }, data });
      }
    }
  }

  // Determine new status
  const newStatus = action === "mark_reviewed" ? "reviewed" : "overridden";

  // For mark_reviewed, check if any non-good units are missing images (warn but allow override)
  const shipment = await prisma.shipments.update({
    where: { id: params.shipmentId },
    data: { reconciliation_status: newStatus },
    select: { id: true, reconciliation_status: true },
  });

  return NextResponse.json({ shipmentId: shipment.id, reconciliationStatus: shipment.reconciliation_status });
}
