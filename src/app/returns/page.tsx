import PageHeader from "@/components/page-header";
import SyncReturnsButton from "@/components/sync-returns-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ReturnActions from "./return-actions";

export default async function ReturnsPage() {
  const returns = await prisma.returns.findMany({
    include: {
      order: { include: { order_items: true } },
      listing: { select: { title: true } },
    },
    orderBy: { creation_date: "desc" },
  });

  // Closed states from the eBay Post-Order API
  const CLOSED_STATES = ["CLOSED"];

  // Calculate summary counts using actual eBay state/status values
  const totalReturns = returns.length;

  // Open/Active: any return whose ebay_state is NOT "CLOSED"
  const openReturns = returns.filter(
    (r) => r.ebay_state && !CLOSED_STATES.includes(r.ebay_state)
  ).length;

  // Refunded: only count returns where an actual refund was issued (not just estimated)
  const refundedReturns = returns.filter(
    (r) => r.actual_refund !== null && Number(r.actual_refund) > 0
  ).length;

  // Escalated: ebay_status is "ESCALATED" or the escalated boolean is true, BUT only if not closed
  const escalatedReturns = returns.filter(
    (r) => (r.escalated || r.ebay_status === "ESCALATED") && !CLOSED_STATES.includes(r.ebay_state ?? "")
  ).length;

  const stateColors: Record<string, string> = {
    // eBay Post-Order API states
    CLOSED: "bg-slate-700 text-slate-300",
    ITEM_READY_TO_SHIP: "bg-yellow-900 text-yellow-300",
    ITEM_SHIPPED: "bg-cyan-900 text-cyan-300",
    ITEM_DELIVERED: "bg-blue-900 text-blue-300",
    REFUND_ISSUED: "bg-green-900 text-green-300",
    LESS_THAN_A_FULL_REFUND_ISSUED: "bg-orange-900 text-orange-300",
    RETURN_STARTED: "bg-yellow-900 text-yellow-300",
    RETURN_DELIVERED: "bg-blue-900 text-blue-300",
    RETURN_CLOSED: "bg-slate-700 text-slate-300",
    RETURN_ESCALATED: "bg-red-900 text-red-300",
    RETURN_REQUESTED: "bg-orange-900 text-orange-300",
    RETURN_SHIPPED: "bg-cyan-900 text-cyan-300",
    // Scrape states
    PENDING: "bg-slate-700 text-slate-300",
    ACTIVE: "bg-yellow-900 text-yellow-300",
    COMPLETE: "bg-green-900 text-green-300",
    FAILED: "bg-red-900 text-red-300",
  };

  const statusColors: Record<string, string> = {
    CLOSED: "bg-slate-700 text-slate-300",
    ESCALATED: "bg-red-900 text-red-300",
    READY_FOR_SHIPPING: "bg-yellow-900 text-yellow-300",
    LESS_THAN_A_FULL_REFUND_ISSUED: "bg-orange-900 text-orange-300",
    REFUND_ISSUED: "bg-green-900 text-green-300",
    WAITING_FOR_RETURN_SHIPPING: "bg-cyan-900 text-cyan-300",
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Returns">
        <SyncReturnsButton />
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Total Returns</p>
          <p className="mt-1 text-2xl font-semibold">{totalReturns}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-yellow-400">Open / Active</p>
          <p className="mt-1 text-2xl font-semibold">{openReturns}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-green-400">Refunded</p>
          <p className="mt-1 text-2xl font-semibold">{refundedReturns}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-red-400">Escalated</p>
          <p className="mt-1 text-2xl font-semibold">{escalatedReturns}</p>
        </div>
      </div>

      {/* Returns List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold mb-3">All Returns</h2>
        <div className="space-y-3 text-sm text-slate-300">
          {returns.length === 0 ? (
            <p className="text-slate-500">No returns found. Click &quot;Sync Returns &amp; INR from eBay&quot; to fetch data.</p>
          ) : (
            returns.map((ret) => {
              const orderItems = ret.order?.order_items ?? [];
              const matchedItem = orderItems.find((i) => i.item_id === ret.item_id);
              const displayTitle = ret.listing?.title ?? matchedItem?.title ?? (ret.item_id ? `Item ${ret.item_id}` : "Unknown Item");

              return (
                <div key={ret.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {ret.ebay_return_id && (
                          <a
                            href={`https://www.ebay.com/myb/PurchaseReturnDetail?returnId=${ret.ebay_return_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-300 hover:bg-purple-800 hover:text-purple-200 transition-colors"
                            title="View return on eBay"
                          >
                            Return #{ret.ebay_return_id} ↗
                          </a>
                        )}
                        {ret.ebay_state && (
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            stateColors[ret.ebay_state] ?? "bg-slate-700 text-slate-300"
                          }`}>
                            {ret.ebay_state}
                          </span>
                        )}
                        {ret.ebay_status && ret.ebay_status !== ret.ebay_state && (
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            statusColors[ret.ebay_status] ?? "bg-slate-700 text-slate-300"
                          }`}>
                            {ret.ebay_status}
                          </span>
                        )}
                        {!ret.ebay_state && ret.scrape_state && (
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            stateColors[ret.scrape_state] ?? "bg-slate-700 text-slate-300"
                          }`}>
                            {ret.scrape_state}
                          </span>
                        )}
                        {ret.ebay_type && (
                          <span className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                            {ret.ebay_type}
                          </span>
                        )}
                        {(ret.escalated || ret.ebay_status === "ESCALATED") && !CLOSED_STATES.includes(ret.ebay_state ?? "") && (
                          <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">ESCALATED</span>
                        )}
                      </div>

                      {/* Item info with eBay link */}
                      {ret.item_id && (
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`https://www.ebay.com/itm/${ret.item_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                          >
                            {displayTitle}
                          </a>
                          <a
                            href={`https://www.ebay.com/itm/${ret.item_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-blue-400 flex-shrink-0"
                            title="Open item on eBay"
                          >
                            ↗
                          </a>
                        </div>
                      )}

                      {/* Links row */}
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        {ret.order_id ? (
                          <>
                            <Link href={`/orders/${ret.order_id}`} className="text-blue-400 hover:underline">
                              Order {ret.order_id}
                            </Link>
                            {ret.order?.order_url && (
                              <a
                                href={ret.order.order_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-500 hover:text-blue-400"
                              >
                                eBay Order ↗
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-600">No matching purchase order</span>
                        )}
                      </div>

                      {/* Details */}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        {ret.return_reason && <span>Reason: {ret.return_reason}</span>}
                        {ret.buyer_login_name && <span>Buyer: {ret.buyer_login_name}</span>}
                        {ret.seller_login_name && <span>Seller: {ret.seller_login_name}</span>}
                        {ret.actual_refund ? (
                          <span className="text-green-400">
                            Refunded: ${Number(ret.actual_refund).toFixed(2)} {ret.refund_currency ?? ""}
                          </span>
                        ) : ret.estimated_refund ? (
                          <span className="text-yellow-400">
                            Est. Refund: ${Number(ret.estimated_refund).toFixed(2)} {ret.refund_currency ?? ""}
                          </span>
                        ) : null}
                        {ret.creation_date && (
                          <span>Created: {ret.creation_date.toISOString().slice(0, 10)}</span>
                        )}
                        {ret.respond_by_date && (
                          <span className="text-orange-400">
                            Respond by: {ret.respond_by_date.toISOString().slice(0, 10)}
                          </span>
                        )}
                        {ret.last_synced_at && (
                          <span>Synced: {ret.last_synced_at.toISOString().slice(0, 16).replace("T", " ")}</span>
                        )}
                      </div>

                      {ret.notes && (
                        <p className="mt-1 text-xs text-slate-500 italic">Notes: {ret.notes}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions for manual returns */}
                  {!ret.ebay_return_id && <ReturnActions returnId={ret.id} />}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
