import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getValidAccessToken } from "@/lib/ebay/token";
import { getOrders } from "@/lib/ebay/trading";
import { deriveShippingStatus } from "@/lib/shipping";
import { z } from "zod";

const schema = z.object({
  ebayAccountId: z.string().optional(),
  orderId: z.string().optional()
});

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const body = schema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Find all eBay accounts or a specific one
    const accountId = body.data.ebayAccountId;
    const accounts = accountId
      ? await prisma.ebay_accounts.findMany({ where: { id: accountId }, select: { id: true } })
      : await prisma.ebay_accounts.findMany({ select: { id: true } });

    if (accounts.length === 0) {
      return NextResponse.json({ error: "No eBay accounts connected" }, { status: 400 });
    }

    const now = new Date();
    // Split 90 days into 3 x 30-day windows to stay within eBay API limits
    const windows: Array<{ from: Date; to: Date }> = [];
    for (let i = 2; i >= 0; i--) {
      const to = new Date(now);
      to.setDate(now.getDate() - i * 30);
      const from = new Date(to);
      from.setDate(to.getDate() - 30);
      windows.push({ from, to: i === 0 ? now : to });
    }
    let totalOrders = 0;

    for (const account of accounts) {
      const { token } = await getValidAccessToken(account.id);

      for (const window of windows) {
        const result = await getOrders(token, window.from.toISOString(), window.to.toISOString());

      for (const order of result.orders) {
        // Upsert the order
        await prisma.orders.upsert({
          where: { order_id: String(order.orderId) },
          update: {
            order_status: order.orderStatus,
            totals: { total: order.total },
            ship_to_city: order.shippingAddress?.city ?? null,
            ship_to_state: order.shippingAddress?.state ?? null,
            ship_to_postal: order.shippingAddress?.postalCode ?? null,
          },
          create: {
            order_id: String(order.orderId),
            ebay_account_id: account.id,
            purchase_date: new Date(order.createdTime),
            order_status: order.orderStatus,
            totals: { total: order.total },
            ship_to_city: order.shippingAddress?.city ?? null,
            ship_to_state: order.shippingAddress?.state ?? null,
            ship_to_postal: order.shippingAddress?.postalCode ?? null,
            order_url: `https://order.ebay.com/ord/show?orderId=${String(order.orderId)}`,
          }
        });

        // Upsert order items and targets
        for (const tx of order.transactions) {
          const itemId = String(tx.itemId);
          // Upsert target
          const existingTarget = await prisma.targets.findUnique({
            where: { item_id: itemId }
          });
          if (existingTarget) {
            await prisma.targets.update({
              where: { item_id: itemId },
              data: {
                status: "PURCHASED",
                status_history: [
                  ...(existingTarget.status_history as any[] ?? []),
                  { status: "PURCHASED", at: new Date().toISOString() }
                ]
              }
            });
          } else {
            await prisma.targets.create({
              data: {
                item_id: itemId,
                type: "BIN",
                max_snipe_bid: null,
                best_offer_amount: null,
                lead_seconds: 5,
                created_by: order.orderId,
                status: "PURCHASED",
                status_history: [{ status: "PURCHASED", at: new Date().toISOString() }]
              }
            });
          }

          // Upsert order item - use order_id + item_id as a lookup
          const existingItem = await prisma.order_items.findFirst({
            where: { order_id: String(order.orderId), item_id: itemId }
          });
          if (existingItem) {
            await prisma.order_items.update({
              where: { id: existingItem.id },
              data: {
                title: String(tx.title),
                qty: Number(tx.quantity),
                transaction_price: Number(tx.transactionPrice),
                shipping_cost: tx.shippingServiceCost ? Number(tx.shippingServiceCost) : null,
                purchase_date: new Date(order.createdTime)
              }
            });
          } else {
            await prisma.order_items.create({
              data: {
                order_id: String(order.orderId),
                item_id: itemId,
                title: tx.title,
                qty: tx.quantity,
                transaction_price: Number(tx.transactionPrice),
                shipping_cost: tx.shippingServiceCost ? Number(tx.shippingServiceCost) : null,
                purchase_date: new Date(order.createdTime)
              }
            });
          }
        }

        // Derive shipping status
        const derivedStatus = deriveShippingStatus({
          actualDelivery: order.delivery.actualDelivery,
          cancelStatus: null,
          scheduledMax: order.delivery.scheduledMax ?? null,
          estimatedMax: order.delivery.estimatedMax ?? null,
          hasTracking: order.shipments.length > 0,
          hasScheduledWindow: Boolean(order.delivery.scheduledMin || order.delivery.scheduledMax),
          hasEstimatedWindow: Boolean(order.delivery.estimatedMin || order.delivery.estimatedMax)
        });

        // Upsert shipment - use order_id to find existing
        const existingShipment = await prisma.shipments.findFirst({
          where: { order_id: String(order.orderId) }
        });
        let shipmentId: string;
        if (existingShipment) {
          await prisma.shipments.update({
            where: { id: existingShipment.id },
            data: {
              derived_status: derivedStatus,
              estimated_min: order.delivery.estimatedMin ? new Date(order.delivery.estimatedMin) : null,
              estimated_max: order.delivery.estimatedMax ? new Date(order.delivery.estimatedMax) : null,
              scheduled_min: order.delivery.scheduledMin ? new Date(order.delivery.scheduledMin) : null,
              scheduled_max: order.delivery.scheduledMax ? new Date(order.delivery.scheduledMax) : null,
              delivered_at: order.delivery.actualDelivery ? new Date(order.delivery.actualDelivery) : null,
              last_refreshed_at: new Date()
            }
          });
          shipmentId = existingShipment.id;
        } else {
          const newShipment = await prisma.shipments.create({
            data: {
              order_id: String(order.orderId),
              derived_status: derivedStatus,
              estimated_min: order.delivery.estimatedMin ? new Date(order.delivery.estimatedMin) : null,
              estimated_max: order.delivery.estimatedMax ? new Date(order.delivery.estimatedMax) : null,
              scheduled_min: order.delivery.scheduledMin ? new Date(order.delivery.scheduledMin) : null,
              scheduled_max: order.delivery.scheduledMax ? new Date(order.delivery.scheduledMax) : null,
              delivered_at: order.delivery.actualDelivery ? new Date(order.delivery.actualDelivery) : null,
              last_refreshed_at: new Date()
            }
          });
          shipmentId = newShipment.id;
        }

        // Upsert tracking numbers
        for (const tracking of order.shipments) {
          if (!tracking.trackingNumber) continue;
          const existingTracking = await prisma.tracking_numbers.findFirst({
            where: { shipment_id: shipmentId, tracking_number: tracking.trackingNumber }
          });
          if (existingTracking) {
            await prisma.tracking_numbers.update({
              where: { id: existingTracking.id },
              data: {
                carrier: tracking.carrier,
                status_text: tracking.statusText,
                last_seen_at: new Date()
              }
            });
          } else {
            await prisma.tracking_numbers.create({
              data: {
                shipment_id: shipmentId,
                carrier: tracking.carrier ?? null,
                tracking_number: tracking.trackingNumber,
                status_text: tracking.statusText ?? null,
                last_seen_at: new Date()
              }
            });
          }
        }

        totalOrders++;
      }
      } // end windows loop

      // Update last sync time on the account
      await prisma.ebay_accounts.update({
        where: { id: account.id },
        data: { last_sync_at: new Date() }
      });
    }

    return NextResponse.json({ ok: true, synced: totalOrders });
  } catch (error: any) {
    console.error("Order sync failed:", error);
    return NextResponse.json({ error: error.message ?? "Sync failed" }, { status: 500 });
  }
}
