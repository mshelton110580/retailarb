import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TargetType, TargetStatus } from "@prisma/client";
import { z } from "zod";

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
      scanned_by_user_id: auth.session.user.id,
      resolution_state: resolutionState,
      notes: body.data.notes ?? null
    }
  });

  // If matched, create received_units for each order item and update shipment status
  const receivedUnits: any[] = [];
  if (matches.length > 0) {
    for (const match of matches) {
      const shipment = match.shipment;
      if (!shipment?.order) continue;

      const orderItems = shipment.order.order_items ?? [];

      for (const item of orderItems) {
        // Check if this item has already been received for this order
        const existing = await prisma.received_units.findFirst({
          where: {
            order_id: shipment.order_id,
            item_id: item.item_id
          }
        });

        if (!existing) {
          try {
            // Ensure target exists (listings FK requires it)
            const existingTarget = await prisma.targets.findUnique({ where: { item_id: item.item_id } });
            if (!existingTarget) {
              await prisma.targets.create({
                data: {
                  item_id: item.item_id,
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
            const existingListing = await prisma.listings.findUnique({ where: { item_id: item.item_id } });
            if (!existingListing) {
              await prisma.listings.create({
                data: {
                  item_id: item.item_id,
                  title: item.title ?? "Unknown",
                  raw_json: {}
                }
              });
            }

            const unit = await prisma.received_units.create({
              data: {
                item_id: item.item_id,
                order_id: shipment.order_id,
                order_item_id: item.id,
                unit_index: 1,
                condition_status: body.data.condition_status,
                scanned_by_user_id: auth.session.user.id,
                notes: body.data.notes ?? null
              }
            });
            receivedUnits.push(unit);
          } catch (err: any) {
            console.error(`Failed to create received_unit for item ${item.item_id}:`, err.message);
          }
        }
      }

      // Mark shipment as checked in (independent of eBay delivery status)
      if (!shipment.checked_in_at) {
        await prisma.shipments.update({
          where: { id: shipment.id },
          data: {
            checked_in_at: new Date(),
            checked_in_by: auth.session!.user!.id
          }
        });
      }
    }
  }

  return NextResponse.json({
    scan,
    resolution: resolutionState,
    matchCount: matches.length,
    receivedUnits: receivedUnits.length,
    orders: matches.map((m) => ({
      orderId: m.shipment?.order_id,
      items: m.shipment?.order?.order_items?.map((i) => ({
        title: i.title,
        qty: i.qty,
        itemId: i.item_id
      }))
    }))
  });
}
