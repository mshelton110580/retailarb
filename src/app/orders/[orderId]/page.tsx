import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function OrderDetailPage({ params }: { params: { orderId: string } }) {
  const order = await prisma.orders.findUnique({
    where: { order_id: params.orderId },
    include: {
      order_items: true,
      shipments: { include: { tracking_numbers: true } },
      returns: true,
      inr_cases: true,
      received_units: {
        include: {
          listing: { select: { title: true } },
          images: { select: { id: true, image_path: true } }
        },
        orderBy: { unit_index: "asc" }
      }
    }
  });

  if (!order) {
    notFound();
  }

  const conditionColors: Record<string, string> = {
    good: "bg-green-900 text-green-300",
    new_sealed: "bg-blue-900 text-blue-300",
    like_new: "bg-cyan-900 text-cyan-300",
    acceptable: "bg-yellow-900 text-yellow-300",
    damaged: "bg-red-900 text-red-300",
    wrong_item: "bg-orange-900 text-orange-300",
    missing_parts: "bg-amber-900 text-amber-300",
    defective: "bg-rose-900 text-rose-300",
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`Order ${order.order_id}`} />

      {/* Order Summary */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Order Details</h2>
          <a
            href={order.order_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
              <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
            </svg>
            View on eBay
          </a>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-500">Status</p>
            <p className="text-slate-200">{order.order_status}</p>
          </div>
          <div>
            <p className="text-slate-500">Purchased</p>
            <p className="text-slate-200">{order.purchase_date.toISOString().slice(0, 10)}</p>
          </div>
          <div>
            <p className="text-slate-500">Ship To</p>
            <p className="text-slate-200">
              {[order.ship_to_city, order.ship_to_state, order.ship_to_postal].filter(Boolean).join(", ") || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Original Total <span className="text-slate-600 text-xs">(incl. tax)</span></p>
            <p className="text-slate-200">
              {order.original_total != null
                ? `$${Number(order.original_total).toFixed(2)}`
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Current Balance</p>
            {(() => {
              const currentTotal = order.totals && typeof order.totals === "object" && "total" in (order.totals as any)
                ? Number((order.totals as any).total)
                : null;
              const hasRefund = currentTotal != null && order.original_total != null && currentTotal < Number(order.original_total);
              const hasTax = order.tax_amount != null && Number(order.tax_amount) > 0;
              return (
                <p className={hasRefund && hasTax ? "text-amber-400 font-medium" : "text-slate-200"}>
                  {currentTotal != null ? `$${currentTotal.toFixed(2)}` : "N/A"}
                  {hasRefund && hasTax && (
                    <span className="ml-2 text-xs" title="This order had tax and a refund — verify the correct amount was received">⚠ tax+refund — verify</span>
                  )}
                  {hasRefund && !hasTax && (
                    <span className="ml-2 text-xs text-slate-400">(refunded)</span>
                  )}
                </p>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Items */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Items</h2>
        {(() => {
          const orderShipping = order.shipping_cost ? Number(order.shipping_cost) : 0;
          const orderTax = order.tax_amount ? Number(order.tax_amount) : 0;
          const totalItemSubtotal = order.order_items.reduce(
            (sum, i) => sum + Number(i.transaction_price) * i.qty, 0
          );
          return (
            <div className="mt-3 space-y-2">
              {order.order_items.map((item) => {
                const unitPrice = Number(item.transaction_price);
                const itemSubtotal = unitPrice * item.qty;
                const proportion = totalItemSubtotal > 0 ? itemSubtotal / totalItemSubtotal : 1 / order.order_items.length;
                const shipping = parseFloat((orderShipping * proportion).toFixed(2));
                const tax = parseFloat((orderTax * proportion).toFixed(2));
                const lineTotal = itemSubtotal + shipping + tax;
                return (
                  <div key={item.id} className="rounded border border-slate-800 p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-blue-400 hover:text-blue-300 hover:underline"
                          title="View item on eBay"
                        >
                          {item.title}
                        </a>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>Item ID: {item.item_id}</span>
                          <span>Qty: {item.qty}</span>
                          <span>
                            {item.qty > 1 ? `$${unitPrice.toFixed(2)} × ${item.qty}` : `$${unitPrice.toFixed(2)}`}
                            {orderShipping === 0
                              ? <span className="ml-1 text-emerald-400">✓ free shipping</span>
                              : ` +$${shipping.toFixed(2)} ship`}
                            {tax > 0 && ` +$${tax.toFixed(2)} tax`}
                            {" = "}<span className="text-slate-200 font-medium">${lineTotal.toFixed(2)}</span>
                          </span>
                        </div>
                      </div>
                      <a
                        href={`https://www.ebay.com/itm/${item.item_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 rounded bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-blue-400 hover:bg-slate-700 transition-colors"
                        title="Open item on eBay"
                      >
                        eBay ↗
                      </a>
                    </div>
                  </div>
                );
              })}
              {/* Order total row */}
              <div className="mt-2 flex justify-end border-t border-slate-700 pt-2 text-sm">
                <div className="space-y-0.5 text-right text-xs text-slate-400">
                  <div>Subtotal: <span className="text-slate-200">${totalItemSubtotal.toFixed(2)}</span></div>
                  {orderShipping > 0 && <div>Shipping: <span className="text-slate-200">${orderShipping.toFixed(2)}</span></div>}
                  {orderShipping === 0 && <div className="text-emerald-400">Free Shipping</div>}
                  {orderTax > 0 && <div>Tax: <span className="text-slate-200">${orderTax.toFixed(2)}</span></div>}
                  <div className="font-semibold text-slate-200">
                    Order Total: {order.original_total != null ? `$${Number(order.original_total).toFixed(2)}` : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Tracking & Shipments */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Tracking & Shipments</h2>
        <div className="mt-3 space-y-3 text-sm text-slate-300">
          {order.shipments.length === 0 ? (
            <p className="text-slate-500">No shipments yet.</p>
          ) : (
            order.shipments.map((shipment) => (
              <div key={shipment.id} className="rounded border border-slate-800 p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    shipment.delivered_at ? "bg-green-900 text-green-300" :
                    shipment.tracking_numbers.length > 0 ? "bg-blue-900 text-blue-300" :
                    "bg-slate-700 text-slate-300"
                  }`}>
                    {shipment.derived_status}
                  </span>
                  {shipment.checked_in_at && (
                    <span className="rounded bg-emerald-900 px-2 py-0.5 text-xs text-emerald-300">
                      Checked in: {shipment.checked_in_at.toISOString().slice(0, 10)}
                    </span>
                  )}
                  {shipment.is_lot && (
                    <span className="rounded bg-fuchsia-900 px-2 py-0.5 text-xs text-fuchsia-300">LOT</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                  <span>Expected: {shipment.expected_units} units</span>
                  <span>Scanned: {shipment.scanned_units} units</span>
                  <span>Scan Status: {shipment.scan_status}</span>
                </div>
                {shipment.tracking_numbers.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {shipment.tracking_numbers.map((track) => (
                      <div key={track.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">{track.carrier ?? "Carrier"}</span>
                        <span className="font-mono">{track.tracking_number}</span>
                        {track.status_text && (
                          <span className="text-slate-500">({track.status_text})</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-3 text-xs text-slate-500">
                  {shipment.delivered_at && <span>Delivered: {shipment.delivered_at.toISOString().slice(0, 10)}</span>}
                  {shipment.estimated_max && !shipment.delivered_at && <span>Est. delivery: {shipment.estimated_max.toISOString().slice(0, 10)}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Received Units */}
      {order.received_units.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Received Units</h2>
          <div className="mt-3 space-y-2">
            {order.received_units.map((unit) => (
              <div key={unit.id} className="rounded border border-slate-800 p-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">#{unit.unit_index}</span>
                  <a
                    href={`https://www.ebay.com/itm/${unit.item_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[350px]"
                  >
                    {unit.listing?.title ?? `Item ${unit.item_id}`}
                  </a>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${conditionColors[unit.condition_status] ?? "bg-slate-700 text-slate-300"}`}>
                    {unit.condition_status.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-500">{unit.received_at.toISOString().slice(0, 10)}</span>
                  {unit.notes && <span className="text-xs text-slate-500 italic">({unit.notes})</span>}
                </div>
                {unit.images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unit.images.map((img) => (
                      <a key={img.id} href={`/api/uploads/${img.image_path}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/uploads/${img.image_path}`}
                          alt="Unit photo"
                          className="h-16 w-16 rounded border border-slate-700 object-cover hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Returns */}
      {order.returns.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Returns</h2>
          <div className="mt-3 space-y-2">
            {order.returns.map((ret) => (
              <div key={ret.id} className="rounded border border-slate-800 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                    {ret.scrape_state}
                  </span>
                  {ret.ebay_return_id && (
                    <span className="text-xs text-slate-400">eBay Return #{ret.ebay_return_id}</span>
                  )}
                  {ret.status_scraped && (
                    <span className="text-xs text-slate-400">Status: {ret.status_scraped}</span>
                  )}
                </div>
                {ret.notes && <p className="mt-1 text-xs text-slate-500">{ret.notes}</p>}
                {ret.refund_amount && (
                  <p className="mt-1 text-xs text-yellow-400">Refund: ${Number(ret.refund_amount).toFixed(2)}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* INR Cases */}
      {order.inr_cases.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Item Not Received (INR) Cases</h2>
          <div className="mt-3 space-y-2">
            {order.inr_cases.map((inr) => (
              <div key={inr.id} className="rounded border border-slate-800 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300">
                    INR
                  </span>
                  {inr.ebay_inquiry_id && (
                    <span className="text-xs text-slate-400">eBay Inquiry #{inr.ebay_inquiry_id}</span>
                  )}
                  {inr.status_text && (
                    <span className="text-xs text-slate-400">Status: {inr.status_text}</span>
                  )}
                </div>
                {inr.notes && <p className="mt-1 text-xs text-slate-500">{inr.notes}</p>}
                {inr.claim_amount && (
                  <p className="mt-1 text-xs text-yellow-400">Claim: ${Number(inr.claim_amount).toFixed(2)}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Quick Links</h2>
        <div className="mt-3 space-y-3">

          {/* eBay order actions */}
          <div>
            <p className="mb-2 text-xs text-slate-500">eBay order actions</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={order.order_url}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-blue-900 px-3 py-2 text-xs font-medium text-blue-300 hover:bg-blue-800 transition-colors"
              >
                View Order on eBay ↗
              </a>
            </div>
          </div>

          {/* Per-item Return / INR actions */}
          {order.order_items.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-slate-500">
                {order.order_items.length === 1 ? "File a case" : "File a case (per item)"}
              </p>
              <div className="space-y-2">
                {order.order_items.map((item) => {
                  const label = item.title.length > 45 ? item.title.slice(0, 45) + "…" : item.title;
                  const returnUrl = item.transaction_id
                    ? `https://www.ebay.com/rtn/Return/ReturnViewSelectedItem?itemId=${item.item_id}&transactionId=${item.transaction_id}`
                    : `https://order.ebay.com/ord/show?orderId=${order.order_id}`;
                  const inrUrl = item.transaction_id
                    ? `https://www.ebay.com/ItemNotReceived/CreateRequest?itemId=${item.item_id}&transactionId=${item.transaction_id}`
                    : `https://order.ebay.com/ord/show?orderId=${order.order_id}`;
                  return (
                    <div key={item.id} className="flex flex-wrap items-center gap-2">
                      {order.order_items.length > 1 && (
                        <span className="text-xs text-slate-500 w-full">{label}</span>
                      )}
                      <a
                        href={returnUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`File a return for: ${item.title}`}
                        className="rounded bg-orange-950 border border-orange-800 px-3 py-2 text-xs font-medium text-orange-300 hover:bg-orange-900 transition-colors"
                      >
                        {order.order_items.length === 1 ? `File Return ↗` : `Return ↗`}
                      </a>
                      <a
                        href={inrUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`File an INR for: ${item.title}`}
                        className="rounded bg-yellow-950 border border-yellow-800 px-3 py-2 text-xs font-medium text-yellow-300 hover:bg-yellow-900 transition-colors"
                      >
                        {order.order_items.length === 1 ? `File INR ↗` : `INR ↗`}
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Item links */}
          {order.order_items.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-slate-500">Item links</p>
              <div className="flex flex-wrap gap-2">
                {order.order_items.map((item) => (
                  <a
                    key={item.id}
                    href={`https://www.ebay.com/itm/${item.item_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                    title={item.title}
                  >
                    {item.title.length > 40 ? item.title.slice(0, 40) + "…" : item.title} ↗
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Nav links */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
            <Link
              href="/orders/search"
              className="rounded bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              ← Order Search
            </Link>
            <Link
              href="/inventory"
              className="rounded bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Inventory
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
