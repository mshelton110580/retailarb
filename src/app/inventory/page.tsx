import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";

type BucketKey =
  | "total_orders"
  | "delivered"
  | "shipped"
  | "never_shipped"
  | "checked_in"
  | "not_checked_in"
  | "overdue_not_received"
  | "needs_return";

const cardConfig: Array<{
  key: BucketKey;
  label: string;
  color: string;
  border: string;
  description?: string;
  section?: string;
}> = [
  // Primary status (mutually exclusive — these three sum to Total Orders)
  { key: "total_orders", label: "Total Orders", color: "text-white", border: "border-slate-500", section: "primary" },
  { key: "delivered", label: "Delivered", color: "text-green-400", border: "border-green-600", description: "eBay confirms delivery", section: "primary" },
  { key: "shipped", label: "Shipped", color: "text-blue-400", border: "border-blue-600", description: "Tracking uploaded, not yet delivered", section: "primary" },
  { key: "never_shipped", label: "Never Shipped", color: "text-rose-400", border: "border-rose-600", description: "No tracking info uploaded", section: "primary" },
  // Warehouse status (mutually exclusive — these two sum to Total Orders)
  { key: "checked_in", label: "Checked In", color: "text-emerald-400", border: "border-emerald-600", description: "Scanned at warehouse", section: "warehouse" },
  { key: "not_checked_in", label: "Not Checked In", color: "text-yellow-400", border: "border-yellow-600", description: "Not yet scanned at warehouse", section: "warehouse" },
  // Action items (may overlap)
  { key: "overdue_not_received", label: "Overdue — Not Received", color: "text-amber-400", border: "border-amber-600", description: "Has tracking, past estimated delivery, no delivery confirmation", section: "action" },
  { key: "needs_return", label: "Needs Return", color: "text-red-400", border: "border-red-600", description: "Checked in with bad condition", section: "action" },
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
  const goodConditions = new Set(["good", "new", "like_new", "like new", "acceptable", "excellent", "GOOD", "NEW", "LIKE_NEW", "ACCEPTABLE", "EXCELLENT"]);
  const needsReturnOrderIds = new Set(
    receivedUnits
      .filter((u) => u.condition_status && !goodConditions.has(u.condition_status))
      .map((u) => u.order_id)
  );

  // Categorize shipments into buckets
  const buckets: Record<BucketKey, typeof shipments> = {
    total_orders: [],
    delivered: [],
    shipped: [],
    never_shipped: [],
    checked_in: [],
    not_checked_in: [],
    overdue_not_received: [],
    needs_return: []
  };

  const now = new Date();
  const DEFAULT_TRANSIT_DAYS = 7;

  for (const shipment of shipments) {
    const orderId = shipment.order_id;
    const hasTracking = (shipment.tracking_numbers?.length ?? 0) > 0;
    const isDelivered = Boolean(shipment.delivered_at);
    const isCheckedIn = Boolean(shipment.checked_in_at);

    // Total orders — every shipment
    buckets.total_orders.push(shipment);

    // === PRIMARY STATUS (mutually exclusive) ===
    if (isDelivered) {
      buckets.delivered.push(shipment);
    } else if (hasTracking) {
      buckets.shipped.push(shipment);
    } else {
      buckets.never_shipped.push(shipment);
    }

    // === WAREHOUSE STATUS (mutually exclusive) ===
    if (isCheckedIn) {
      buckets.checked_in.push(shipment);
    } else {
      buckets.not_checked_in.push(shipment);
    }

    // === ACTION ITEMS (may overlap with primary/warehouse) ===

    // Overdue: has tracking, no delivery, past expected date
    let expectedBy: Date | null = null;
    if (shipment.estimated_max) {
      expectedBy = new Date(shipment.estimated_max);
    } else if (shipment.order?.purchase_date) {
      expectedBy = new Date(shipment.order.purchase_date);
      expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
    }
    if (hasTracking && !isDelivered && expectedBy && now > expectedBy) {
      buckets.overdue_not_received.push(shipment);
    }

    // Needs return: checked in with bad condition
    if (needsReturnOrderIds.has(orderId)) {
      buckets.needs_return.push(shipment);
    }
  }

  const filteredItems = activeFilter ? buckets[activeFilter] ?? [] : [];

  // Group cards by section for visual separation
  const primaryCards = cardConfig.filter((c) => c.section === "primary");
  const warehouseCards = cardConfig.filter((c) => c.section === "warehouse");
  const actionCards = cardConfig.filter((c) => c.section === "action");

  function renderCards(cards: typeof cardConfig) {
    return cards.map((card) => {
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
          {card.description && (
            <p className="mt-1 text-xs text-slate-500">{card.description}</p>
          )}
        </Link>
      );
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Dashboard" />

      {/* Primary Status — Mutually Exclusive */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Delivery Status</h2>
        <p className="mb-3 text-xs text-slate-600">Delivered + Shipped + Never Shipped = Total Orders</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(primaryCards)}
        </div>
      </div>

      {/* Warehouse Status — Mutually Exclusive */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Warehouse Status</h2>
        <p className="mb-3 text-xs text-slate-600">Checked In + Not Checked In = Total Orders</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(warehouseCards)}
        </div>
      </div>

      {/* Action Items */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Action Items</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(actionCards)}
        </div>
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
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        shipment.delivered_at ? 'bg-green-900 text-green-300' :
                        (shipment.tracking_numbers?.length ?? 0) > 0 ? 'bg-blue-900 text-blue-300' :
                        'bg-rose-900 text-rose-300'
                      }`}>
                        {shipment.delivered_at ? 'Delivered' :
                         (shipment.tracking_numbers?.length ?? 0) > 0 ? 'Shipped' :
                         'Never Shipped'}
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
                    {shipment.order?.purchase_date && (
                      <span>Purchased: {shipment.order.purchase_date.toISOString().slice(0, 10)}</span>
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
