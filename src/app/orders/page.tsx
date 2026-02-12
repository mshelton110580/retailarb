import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";
import RefreshButton from "./refresh-button";

const statusColors: Record<string, string> = {
  delivered: "bg-green-600",
  shipped: "bg-blue-600",
  pre_shipment: "bg-yellow-600",
  pending: "bg-gray-600",
  late: "bg-orange-600",
  not_delivered: "bg-red-600",
  not_received: "bg-rose-600",
  canceled: "bg-red-800",
  unknown: "bg-gray-600"
};

const statusLabels: Record<string, string> = {
  delivered: "Delivered",
  shipped: "Shipped",
  pre_shipment: "Pre-Shipment",
  pending: "Pending",
  late: "Late",
  not_delivered: "Not Delivered",
  not_received: "Never Shipped",
  canceled: "Canceled",
  unknown: "Unknown"
};

export default async function OrdersPage() {
  const orders = await prisma.orders.findMany({
    orderBy: { purchase_date: "desc" },
    take: 100,
    include: {
      shipments: true,
      order_items: true
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Orders">
        <RefreshButton />
      </PageHeader>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-3 text-sm text-slate-300">
          {orders.length === 0 ? (
            <p>No orders synced.</p>
          ) : (
            orders.map((order) => (
              <div key={order.order_id} className="rounded border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <Link className="font-medium" href={`/orders/${order.order_id}`}>
                    {order.order_id}
                  </Link>
                  <a
                    className="text-xs text-blue-400"
                    href={order.order_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open order
                  </a>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium text-white ${statusColors[order.shipments?.[0]?.derived_status ?? "unknown"] ?? "bg-gray-600"}`}>
                    {statusLabels[order.shipments?.[0]?.derived_status ?? "unknown"] ?? "Unknown"}
                  </span>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${order.shipments?.[0]?.checked_in_at ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-700 text-slate-300'}`}>
                    {order.shipments?.[0]?.checked_in_at ? `Checked In ${order.shipments[0].checked_in_at.toISOString().slice(0, 10)}` : 'Not Checked In'}
                  </span>
                  <span>eBay: {order.order_status}</span>
                  <span>·</span>
                  <span>Purchased {order.purchase_date.toISOString().slice(0, 10)}</span>
                  {order.shipments?.[0]?.delivered_at && (
                    <><span>·</span><span>Delivered {order.shipments[0].delivered_at.toISOString().slice(0, 10)}</span></>
                  )}
                  {order.order_items?.length > 0 && (
                    <><span>·</span><span>{order.order_items.length} item{order.order_items.length > 1 ? "s" : ""}</span></>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
