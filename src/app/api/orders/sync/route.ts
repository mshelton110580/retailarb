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

export async function syncOrders(ebayAccountId?: string): Promise<{ synced: number }> {
  const accounts = ebayAccountId
    ? await prisma.ebay_accounts.findMany({ where: { id: ebayAccountId }, select: { id: true } })
    : await prisma.ebay_accounts.findMany({ select: { id: true } });

  if (accounts.length === 0) throw new Error("No eBay accounts connected");

  const now = new Date();
  const earliestDate = new Date(now);
  earliestDate.setDate(earliestDate.getDate() - 90);
  const windows: Array<{ from: Date; to: Date }> = [{ from: earliestDate, to: now }];
  console.log(`[Order Sync] Fetching orders from ${earliestDate.toISOString()} to ${now.toISOString()} (90-day limit)`);

  let totalOrders = 0;

  for (const account of accounts) {
    const { token } = await getValidAccessToken(account.id);

    for (const window of windows) {
      console.log(`[Order Sync] Fetching orders from ${window.from.toISOString()} to ${window.to.toISOString()}`);

      try {
        const result = await getOrders(token, window.from.toISOString(), window.to.toISOString());
        console.log(`[Order Sync] Window returned ${result.orders.length} orders`);

        for (const order of result.orders) {
          // Upsert the order.
          // subtotal = eBay Subtotal (items only) — immutable, never changes after purchase.
          // shipping_cost priority:
          //   1. Sum of Transaction.ActualShippingCost (set at checkout, most reliable when present)
          //   2. Sum of Transaction.ShippingServiceCost (transaction-level negotiated cost)
          //   3. Order-level ShippingServiceSelected.ShippingServiceCost (summed across all svc entries)
          //      — this handles multi-item orders where eBay stores per-transaction shipping at order level
          // original_total = subtotal + shipping_cost — set on CREATE only, never overwritten.
          // totals.total is always updated to the current (possibly post-refund) value.
          const subtotalNum = parseFloat(order.subtotal);

          // 1. Try ActualShippingCost sum across transactions
          const txActualShippingSum = order.transactions.reduce(
            (sum, tx) => sum + (tx.actualShippingCost ? parseFloat(tx.actualShippingCost) : 0), 0
          );
          // 2. Try ShippingServiceCost sum across transactions (transaction-level)
          const txServiceShippingSum = order.transactions.reduce(
            (sum, tx) => sum + (tx.shippingServiceCost ? parseFloat(tx.shippingServiceCost) : 0), 0
          );
          // 3. Order-level ShippingServiceCost (already summed across svc entries in trading.ts)
          const orderLevelShipping = parseFloat(order.shippingCost);

          const ebayShippingNum = txActualShippingSum > 0
            ? parseFloat(txActualShippingSum.toFixed(2))
            : txServiceShippingSum > 0
              ? parseFloat(txServiceShippingSum.toFixed(2))
              : orderLevelShipping;

          // Log shipping breakdown for diagnosis — remove once root cause confirmed
          console.log(`[Order Sync] ${order.orderId} shipping: txActual=${txActualShippingSum} txService=${txServiceShippingSum} orderLevel=${orderLevelShipping} → used=${ebayShippingNum}`);

          const shippingNum = ebayShippingNum;

          const taxNum = parseFloat(parseFloat(order.taxAmount).toFixed(2));
          const originalTotal = parseFloat((subtotalNum + shippingNum + taxNum).toFixed(2));

          await prisma.orders.upsert({
            where: { order_id: String(order.orderId) },
            update: {
              order_status: order.orderStatus,
              totals: { total: order.total },
              tax_amount: taxNum,
              ship_to_city: order.shippingAddress?.city ?? null,
              ship_to_state: order.shippingAddress?.state ?? null,
              ship_to_postal: order.shippingAddress?.postalCode ?? null,
              // Update shipping_cost and original_total only when eBay returns a real
              // shipping value (> 0). This handles completed orders where eBay initially
              // returns 0 but later syncs return the actual cost.
              // Prisma does not support conditional field updates in upsert directly,
              // so we handle the shipping upgrade in a separate updateMany below.
            },
            create: {
              order_id: String(order.orderId),
              ebay_account_id: account.id,
              purchase_date: new Date(order.createdTime),
              order_status: order.orderStatus,
              totals: { total: order.total },
              subtotal: subtotalNum,
              shipping_cost: shippingNum,
              original_total: originalTotal,
              tax_amount: taxNum,
              ship_to_city: order.shippingAddress?.city ?? null,
              ship_to_state: order.shippingAddress?.state ?? null,
              ship_to_postal: order.shippingAddress?.postalCode ?? null,
              order_url: `https://order.ebay.com/ord/show?orderId=${String(order.orderId)}`,
            }
          });

          // If eBay returned a real shipping cost this sync, upgrade shipping_cost and
          // original_total on any row where shipping was previously stored as 0.
          // This is not a backfill — it's the normal update path for completed orders
          // where eBay's API returns 0 on early syncs and the real value on later syncs.
          if (shippingNum > 0) {
            await prisma.orders.updateMany({
              where: { order_id: String(order.orderId), shipping_cost: 0 },
              data: { shipping_cost: shippingNum, original_total: originalTotal },
            });
          }

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

            // Upsert order item using the deterministic composite key: orderId-itemId
            await prisma.order_items.upsert({
              where: { id: `${String(order.orderId)}-${itemId}` },
              update: {
                title: String(tx.title),
                qty: Number(tx.quantity),
                transaction_price: Number(tx.transactionPrice),
                shipping_cost: tx.shippingServiceCost ? Number(tx.shippingServiceCost) : null,
                purchase_date: new Date(order.createdTime)
              },
              create: {
                id: `${String(order.orderId)}-${itemId}`,
                order_id: String(order.orderId),
                item_id: itemId,
                title: String(tx.title),
                qty: Number(tx.quantity),
                transaction_price: Number(tx.transactionPrice),
                shipping_cost: tx.shippingServiceCost ? Number(tx.shippingServiceCost) : null,
                purchase_date: new Date(order.createdTime)
              }
            });
          }

          // Derive shipping status
          const derivedStatus = deriveShippingStatus({
            actualDelivery: order.delivery.actualDelivery,
            cancelStatus: null,
            scheduledMax: order.delivery.scheduledMax ?? null,
            estimatedMax: order.delivery.estimatedMax ?? null,
            hasTracking: order.shipments.length > 0,
            hasScheduledWindow: Boolean(order.delivery.scheduledMin || order.delivery.scheduledMax),
            hasEstimatedWindow: Boolean(order.delivery.estimatedMin || order.delivery.estimatedMax),
            shippedTime: order.shippedTime ?? null,
            orderStatus: order.orderStatus,
            purchaseDate: order.createdTime ?? null
          });

          // Calculate expected units from order transactions
          const totalExpectedUnits = order.transactions.reduce((sum, txn) => sum + (txn.quantity || 1), 0);

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
                last_refreshed_at: new Date(),
                expected_units: totalExpectedUnits
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
                last_refreshed_at: new Date(),
                expected_units: totalExpectedUnits
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
      } catch (err: any) {
        console.error(`[Order Sync] Window ${window.from.toISOString()} to ${window.to.toISOString()} failed:`, err.message);
        // Continue with next window instead of failing entirely
      }
    } // end windows loop

    // Update last sync time on the account
    await prisma.ebay_accounts.update({
      where: { id: account.id },
      data: { last_sync_at: new Date() }
    });
  }

  return { synced: totalOrders };
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  let payload: unknown = {};
  try { payload = await req.json(); } catch { payload = {}; }
  const body = schema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  try {
    const result = await syncOrders(body.data.ebayAccountId);
    return NextResponse.json({ ok: true, synced: result.synced });
  } catch (error: any) {
    console.error("Order sync failed:", error);
    return NextResponse.json({ error: error.message ?? "Sync failed" }, { status: 500 });
  }
}
