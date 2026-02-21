import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  count: z.number().int().min(1).max(100),
  notes: z.string().optional(),
});

/**
 * POST /api/reconciliation/[shipmentId]/add-unit
 *
 * Adds one or more "missing" units to a lot.  Each added unit is created with
 * condition_status = "missing" and inventory_state = "missing" so they
 * appear in the unit table and can be edited during reconciliation.
 *
 * Also increments shipment.scanned_units and resets reconciliation_status to
 * "pending" so the lot must be re-reviewed after missing units are added.
 */
export async function POST(
  req: Request,
  { params }: { params: { shipmentId: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { count, notes } = body.data;

  const shipment = await prisma.shipments.findUnique({
    where: { id: params.shipmentId },
    include: {
      order: { include: { order_items: true } },
    },
  });

  if (!shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  if (!shipment.order_id) return NextResponse.json({ error: "Shipment has no order" }, { status: 400 });

  const orderItems = shipment.order.order_items;
  if (orderItems.length === 0) return NextResponse.json({ error: "No order items found" }, { status: 400 });

  // Use the first order item as the target (same as lot scan logic)
  const targetItem = orderItems[0];

  // Current unit count for this order (to calculate new unit_index values)
  const existingUnitCount = await prisma.received_units.count({
    where: { order_id: shipment.order_id },
  });

  // Create each missing unit
  const createdUnits: string[] = [];
  for (let i = 0; i < count; i++) {
    const newUnitIndex = existingUnitCount + i + 1;
    const unit = await prisma.received_units.create({
      data: {
        item_id: targetItem.item_id,
        order_id: shipment.order_id,
        order_item_id: targetItem.id,
        unit_index: newUnitIndex,
        condition_status: "missing",
        inventory_state: "missing",
        scanned_by_user_id: auth.session!.user!.id,
        notes: notes?.trim() || "Added as missing unit during lot reconciliation",
      },
    });
    createdUnits.push(unit.id);
  }

  const newScannedUnits = shipment.scanned_units + count;
  const orderQty = orderItems.reduce((s, i) => s + i.qty, 0);

  // Recalculate lot_size with the new count
  const lotSize = shipment.is_lot && orderQty > 0
    ? Math.ceil(newScannedUnits / orderQty)
    : (shipment.lot_size ?? null);

  // Update shipment: increment scanned_units, recalculate lot_size, reopen reconciliation
  await prisma.shipments.update({
    where: { id: params.shipmentId },
    data: {
      scanned_units: newScannedUnits,
      lot_size: lotSize,
      scan_status: "check_quantity",
      is_lot: true,
      reconciliation_status: "pending",
    },
  });

  return NextResponse.json({
    ok: true,
    added: count,
    unitIds: createdUnits,
    newScannedUnits,
  });
}
