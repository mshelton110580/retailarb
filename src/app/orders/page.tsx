import PageHeader from "@/components/page-header";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import { prisma } from "@/lib/db";
import Link from "next/link";
import SyncAllButton from "@/components/sync-all-button";

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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const dateRange = getDateRangeFromParams(params);

  const orders = await prisma.orders.findMany({
    where: {
      purchase_date: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
    },
    orderBy: { purchase_date: "desc" },
    include: {
      shipments: true,
      order_items: true
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Orders">
        <SyncAllButton />
      </PageHeader>
      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{orders.length} orders</span>
      </div>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-3 text-sm text-slate-300">
          {orders.length === 0 ? (
            <p>No orders in this date range.</p>
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
                    Open order on eBay
                  </a>
                </div>
                {/* Item list with eBay links */}
                {order.order_items?.length > 0 && (() => {
                  // Order-level shipping cost (stored immutably on first sync from ShippingServiceCost)
                  // May be 0 for some multi-item orders where eBay doesn't report it at order level.
                  const orderShipping = order.shipping_cost ? Number(order.shipping_cost) : 0;
                  const orderTax = order.tax_amount ? Number(order.tax_amount) : 0;
                  const totalItemSubtotal = order.order_items.reduce(
                    (sum, i) => sum + Number(i.transaction_price) * i.qty, 0
                  );

                  return (
                  <div className="mt-2 space-y-1">
                    {order.order_items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[500px]"
                          title={item.title ?? "View on eBay"}
                        >
                          {item.title ?? `Item ${item.item_id}`}
                        </a>
                        <span className="text-slate-500">x{item.qty}</span>
                        <span className="text-slate-500">
                          {(() => {
                            const unitPrice = Number(item.transaction_price);
                            const itemSubtotal = unitPrice * item.qty;
                            // Allocate shipping proportionally by item subtotal share
                            const proportion = totalItemSubtotal > 0 ? itemSubtotal / totalItemSubtotal : 1 / order.order_items.length;
                            const shipping = parseFloat((orderShipping * proportion).toFixed(2));
                            const tax = parseFloat((orderTax * proportion).toFixed(2));
                            const lineTotal = itemSubtotal + shipping + tax;
                            const parts: string[] = [];
                            if (item.qty > 1) parts.push(`$${unitPrice.toFixed(2)} × ${item.qty}`);
                            else parts.push(`$${unitPrice.toFixed(2)}`);
                            if (orderShipping === 0) parts.push("✓ free ship");
                            else if (shipping > 0) parts.push(`+$${shipping.toFixed(2)} ship`);
                            if (tax > 0) parts.push(`+$${tax.toFixed(2)} tax`);
                            return `${parts.join(" ")} = $${lineTotal.toFixed(2)}`;
                          })()}
                        </span>
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400 ml-1"
                          title="Open item on eBay"
                        >
                          ↗
                        </a>
                      </div>
                    ))}
                    <div className="mt-1 text-right text-xs text-slate-500">
                      Order total: <span className="text-slate-300 font-medium">
                        ${(order.original_total ? Number(order.original_total) : totalItemSubtotal + orderShipping + orderTax).toFixed(2)}
                      </span>
                      {Number((order.totals as any)?.total ?? order.original_total ?? 0) < Number(order.original_total ?? 0) && (
                        <span className="ml-2 text-amber-400" title="Refund detected — original total may differ from amount actually received">⚠ refund</span>
                      )}
                    </div>
                  </div>
                  );
                })()}
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
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
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
