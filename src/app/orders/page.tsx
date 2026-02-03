import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";
import RefreshButton from "./refresh-button";

export default async function OrdersPage() {
  const orders = await prisma.orders.findMany({
    orderBy: { purchase_date: "desc" },
    take: 50
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
                <p className="text-xs text-slate-400">
                  Status: {order.order_status} · Purchased{" "}
                  {order.purchase_date.toISOString().slice(0, 10)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
