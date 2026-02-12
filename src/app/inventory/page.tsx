import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";

type BucketKey = "in_transit" | "shipped" | "delivered" | "not_checked_in" | "late" | "not_delivered" | "needs_return" | "pending";

const cardConfig: Array<{ key: BucketKey; label: string; color: string; border: string }> = [
  { key: "in_transit", label: "In Transit", color: "text-blue-400", border: "border-blue-600" },
  { key: "shipped", label: "Shipped", color: "text-cyan-400", border: "border-cyan-600" },
  { key: "delivered", label: "Delivered", color: "text-green-400", border: "border-green-600" },
  { key: "not_checked_in", label: "Delivered — Not Checked In", color: "text-yellow-400", border: "border-yellow-600" },
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
    not_checked_in: [],
    late: [],
    not_delivered: [],
    needs_return: [],
    pending: []
  };

  for (const shipment of shipments) {
    const orderId = shipment.order_id;
    // Check needs_return first (checked in but bad condition)
    if (needsReturnOrderIds.has(orderId)) {
      buckets.needs_return.push(shipment);
    }
    switch (shipment.derived_status) {
      case "delivered":
        buckets.delivered.push(shipment);
        if (!receivedOrderIds.has(orderId)) {
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
                    <span className="text-xs text-slate-500">{shipment.derived_status}</span>
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
