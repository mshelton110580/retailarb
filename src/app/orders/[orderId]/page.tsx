import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

export default async function OrderDetailPage({ params }: { params: { orderId: string } }) {
  const order = await prisma.orders.findUnique({
    where: { order_id: params.orderId },
    include: { order_items: true, shipments: { include: { tracking_numbers: true } } }
  });

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Order ${order.order_id}`} />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Order details</h2>
        <p className="mt-2 text-sm text-slate-300">Status: {order.order_status}</p>
        <p className="text-sm text-slate-300">Purchased: {order.purchase_date.toISOString()}</p>
        <p className="text-sm text-slate-300">
          Ship to: {order.ship_to_city} {order.ship_to_state} {order.ship_to_postal}
        </p>
      </section>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Items</h2>
        <ul className="mt-2 space-y-2 text-sm text-slate-300">
          {order.order_items.map((item) => (
            <li key={item.id} className="rounded border border-slate-800 p-3">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-slate-400">
                Item {item.item_id} · Qty {item.qty} · Transaction {item.transaction_price.toString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Tracking</h2>
        <div className="mt-2 space-y-3 text-sm text-slate-300">
          {order.shipments.map((shipment) => (
            <div key={shipment.id} className="rounded border border-slate-800 p-3">
              <p className="text-xs text-slate-400">Status: {shipment.derived_status}</p>
              <ul className="mt-2 space-y-1">
                {shipment.tracking_numbers.map((track) => (
                  <li key={track.id}>
                    {track.carrier ?? "Carrier"} · {track.tracking_number}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {order.shipments.length === 0 ? <p>No shipments yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
