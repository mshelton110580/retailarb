import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";

type BucketKey = "in_transit" | "shipped" | "delivered" | "checked_in" | "not_checked_in" | "overdue_not_received" | "never_shipped" | "late" | "not_delivered" | "needs_return" | "pending";

const cardConfig: Array<{ key: BucketKey; label: string; color: string; border: string; description?: string }> = [
  { key: "in_transit", label: "In Transit", color: "text-blue-400", border: "border-blue-600" },
  { key: "shipped", label: "Shipped", color: "text-cyan-400", border: "border-cyan-600" },
  { key: "delivered", label: "Delivered (eBay)", color: "text-green-400", border: "border-green-600" },
  { key: "checked_in", label: "Checked In", color: "text-emerald-400", border: "border-emerald-600", description: "Scanned and received at warehouse" },
  { key: "not_checked_in", label: "Not Checked In", color: "text-yellow-400", border: "border-yellow-600", description: "Delivered per eBay but not yet scanned" },
  { key: "overdue_not_received", label: "Overdue — Not Received", color: "text-amber-400", border: "border-amber-600", description: "Tracking uploaded, past estimated delivery, no delivery confirmation" },
  { key: "never_shipped", label: "Never Shipped", color: "text-rose-400", border: "border-rose-600", description: "No tracking info after estimated delivery date" },
  { key: "needs_return", label: "Needs Return", color: "text-red-400", border: "border-red-600" },
  { key: "late", label: "Late", color: "text-orange-400", border: "border-orange-600" },
  { key: "not_delivered", label: "Not Delivered", color: "text-red-400", border: "border-red-500" },
  { key: "pending", label: "Pending", color: "text-slate-400", border: "border-slate-600" }
];

export default async function InventoryPage({
  searchParams
}: {
  searchParams: { filter?: string };
}) {
  const activeFilter = (searchParams.filter ?? null) as BucketKey | null;

  // Fetch all shipments with order + items
  const shipments = await prisma.shipments.findMany({
    include: {
      order: {
        include: {
          order_items: true
        }
      },
      tracking_numbers: true
    }
  });

  // Fetch received units with condition
  const receivedUnits = await prisma.received_units.findMany({
    select: { order_id: true, item_id: true, condition_status: true }
  });

  const receivedOrderIds = new Set(receivedUnits.map((u) => u.order_id));
  // Items checked in with bad condition (not "good", "new", "like_new", "acceptable")
  const goodConditions = new Set(["good", "new", "like_new", "like new", "acceptable", "excellent", "GOOD", "NEW", "LIKE_NEW", "ACCEPTABLE", "EXCELLENT"]);
  const needsReturnOrderIds = new Set(
    receivedUnits
      .filter((u) => u.condition_status && !goodConditions.has(u.condition_status))
      .map((u) => u.order_id)
  );

  // Categorize shipments into buckets
  const buckets: Record<BucketKey, typeof shipments> = {
    in_transit: [],
    shipped: [],
    delivered: [],
    checked_in: [],
    not_checked_in: [],
    overdue_not_received: [],
    never_shipped: [],
    late: [],
    not_delivered: [],
    needs_return: [],
    pending: []
  };

  const now = new Date();
  // Default transit window: if no estimated_max, use purchase_date + 7 days as expected delivery
  const DEFAULT_TRANSIT_DAYS = 7;

  for (const shipment of shipments) {
    const orderId = shipment.order_id;
    const hasTracking = (shipment.tracking_numbers?.length ?? 0) > 0;
    const notDelivered = !shipment.delivered_at;
    const isCheckedIn = Boolean(shipment.checked_in_at);

    // Checked in (scanned at warehouse)
    if (isCheckedIn) {
      buckets.checked_in.push(shipment);
    }

    // Check needs_return (checked in but bad condition)
    if (needsReturnOrderIds.has(orderId)) {
      buckets.needs_return.push(shipment);
    }

    // Determine expected delivery date
    let expectedBy: Date | null = null;
    if (shipment.estimated_max) {
      expectedBy = new Date(shipment.estimated_max);
    } else if (shipment.order?.purchase_date) {
      expectedBy = new Date(shipment.order.purchase_date);
      expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
    }

    // Check overdue_not_received: has tracking, no delivery, past expected date
    if (hasTracking && notDelivered && expectedBy && now > expectedBy) {
      buckets.overdue_not_received.push(shipment);
    }

    // Check never_shipped: no tracking at all, past expected delivery date
    if (!hasTracking && notDelivered && expectedBy && now > expectedBy) {
      buckets.never_shipped.push(shipment);
    }

    switch (shipment.derived_status) {
      case "delivered":
        buckets.delivered.push(shipment);
        if (!isCheckedIn) {
          buckets.not_checked_in.push(shipment);
        }
        break;
      case "shipped":
        buckets.shipped.push(shipment);
        buckets.in_transit.push(shipment);
        break;
      case "pre_shipment":
        buckets.in_transit.push(shipment);
        break;
      case "late":
        buckets.late.push(shipment);
        buckets.in_transit.push(shipment);
        break;
      case "not_delivered":
        buckets.not_delivered.push(shipment);
        break;
      case "not_received":
        // Derived from shipping.ts: no tracking, past expected date
        buckets.never_shipped.push(shipment);
        break;
      case "pending":
        buckets.pending.push(shipment);
        break;
      default:
        buckets.in_transit.push(shipment);
        break;
    }
  }

  const filteredItems = activeFilter ? buckets[activeFilter] ?? [] : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Dashboard" />
      <div className="grid gap-4 md:grid-cols-4">
        {cardConfig.map((card) => {
          const count = buckets[card.key].length;
          const isActive = activeFilter === card.key;
          return (
            <Link
              key={card.key}
              href={isActive ? "/inventory" : `/inventory?filter=${card.key}`}
              className={`rounded-lg border p-4 transition-colors hover:bg-slate-800 cursor-pointer ${
                isActive ? `${card.border} bg-slate-800` : "border-slate-800 bg-slate-900"
              }`}
            >
              <p className={`text-sm ${card.color}`}>{card.label}</p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </Link>
          );
        })}
      </div>

      {activeFilter && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            {cardConfig.find((c) => c.key === activeFilter)?.label ?? activeFilter} ({filteredItems.length})
          </h2>
          <div className="space-y-2 text-sm text-slate-300">
            {filteredItems.length === 0 ? (
              <p>No items in this category.</p>
            ) : (
              filteredItems.map((shipment) => (
                <div key={shipment.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-center justify-between">
                    <Link className="font-medium text-blue-400" href={`/orders/${shipment.order_id}`}>
                      Order {shipment.order_id}
                    </Link>
                    <div className="flex gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${shipment.derived_status === 'delivered' ? 'bg-green-900 text-green-300' : shipment.derived_status === 'shipped' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>
                        eBay: {shipment.derived_status}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${shipment.checked_in_at ? 'bg-emerald-900 text-emerald-300' : 'bg-yellow-900 text-yellow-300'}`}>
                        {shipment.checked_in_at ? `Checked in: ${shipment.checked_in_at.toISOString().slice(0, 10)}` : 'Not checked in'}
                      </span>
                    </div>
                  </div>
                  {shipment.order?.order_items?.map((item) => (
                    <p key={item.id} className="mt-1 text-xs text-slate-400">
                      {item.title} (x{item.qty}) — ${Number(item.transaction_price).toFixed(2)}
                    </p>
                  ))}
                  <div className="mt-1 flex gap-3 text-xs text-slate-500">
                    {shipment.tracking_numbers?.map((tn) => (
                      <span key={tn.id}>{tn.carrier}: {tn.tracking_number}</span>
                    ))}
                    {shipment.delivered_at && (
                      <span>Delivered: {shipment.delivered_at.toISOString().slice(0, 10)}</span>
                    )}
                    {shipment.estimated_max && !shipment.delivered_at && (
                      <span>Est. delivery: {shipment.estimated_max.toISOString().slice(0, 10)}</span>
                    )}
                    {!shipment.delivered_at && !shipment.estimated_max && shipment.order?.purchase_date && (
                      <span>Purchased: {shipment.order.purchase_date.toISOString().slice(0, 10)} (est. +7 days)</span>
                    )}
                    {shipment.order?.purchase_date && (
                      <span>Days since purchase: {Math.floor((Date.now() - new Date(shipment.order.purchase_date).getTime()) / (1000 * 60 * 60 * 24))}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
