import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import INRAction from "./inr-action";

export default async function INRPage() {
  const lateShipments = await prisma.shipments.findMany({
    where: { derived_status: { in: ["late", "not_delivered"] } },
    include: { order: true },
    orderBy: { last_refreshed_at: "desc" }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Item Not Received (INR)" />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-3 text-sm text-slate-300">
          {lateShipments.length === 0 ? (
            <p>No late or not-delivered shipments.</p>
          ) : (
            lateShipments.map((shipment) => (
              <div key={shipment.id} className="rounded border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Order {shipment.order_id}</p>
                    <p className="text-xs text-slate-400">
                      Status: {shipment.derived_status}
                    </p>
                  </div>
                  <a
                    className="text-xs text-blue-400"
                    href={shipment.order.order_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open order details
                  </a>
                </div>
                <INRAction orderId={shipment.order_id} />
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
