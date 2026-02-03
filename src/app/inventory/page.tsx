import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";

export default async function InventoryPage() {
  const shipments = await prisma.shipments.findMany({
    include: { order: { include: { order_items: true } } }
  });
  const receivedOrderIds = new Set(
    (
      await prisma.received_units.findMany({
        select: { order_id: true }
      })
    ).map((unit) => unit.order_id)
  );

  const buckets = {
    won: 0,
    inTransit: 0,
    delivered: 0,
    deliveredNotCheckedIn: 0,
    late: 0,
    notDelivered: 0
  };

  shipments.forEach((shipment) => {
    switch (shipment.derived_status) {
      case "delivered":
        buckets.delivered += 1;
        if (!receivedOrderIds.has(shipment.order_id)) {
          buckets.deliveredNotCheckedIn += 1;
        }
        break;
      case "late":
        buckets.late += 1;
        break;
      case "not_delivered":
        buckets.notDelivered += 1;
        break;
      default:
        buckets.inTransit += 1;
        break;
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory dashboards" />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "In transit", value: buckets.inTransit },
          { label: "Delivered", value: buckets.delivered },
          { label: "Delivered not checked-in", value: buckets.deliveredNotCheckedIn },
          { label: "Late", value: buckets.late },
          { label: "Not delivered", value: buckets.notDelivered }
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
