import PageHeader from "@/components/page-header";
import SyncReturnsButton from "@/components/sync-returns-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ReturnActions from "./return-actions";
import { JsonValue } from "@prisma/client/runtime/library";

type FilterType =
  | "all"
  | "open"
  | "closed_full_refund"
  | "closed_partial_refund"
  | "closed_no_refund"
  | "escalated";

// States that indicate the return is still active (not closed)
const CLOSED_STATES = ["CLOSED"];

/**
 * Get the order total from the order's totals JSON.
 */
function getOrderTotal(totals: JsonValue | undefined | null): number | null {
  if (!totals) return null;
  const t = totals as { total?: string };
  if (t.total == null) return null;
  const val = Number(t.total);
  return isNaN(val) ? null : val;
}

/**
 * Determine the refund classification for a return.
 *
 * For non-escalated closed returns, uses actual_refund vs estimated_refund:
 *   - actual_refund = estimated_refund → Full Refund
 *   - 0 < actual_refund < estimated_refund → Partial Refund
 *   - actual_refund is null/0 → No Refund
 *
 * For escalated returns:
 *   - If actual_refund data exists, use it (same as above)
 *   - If no actual_refund, fall back to order_total:
 *     - order_total = 0 → Full Refund
 *     - order_total > 0 → No Refund (returned too late, no refund issued)
 *     - No order data → Escalated (can't determine, older than 90-day window)
 *
 * Special statuses:
 *   - LESS_THAN_A_FULL_REFUND_ISSUED → Partial Refund
 */
function getReturnRefundType(ret: {
  actual_refund: unknown;
  estimated_refund: unknown;
  ebay_status: string | null;
  ebay_state: string | null;
  escalated: boolean;
  orderTotals: JsonValue | undefined | null;
}): "full" | "partial" | "none" | "escalated" | "open" {
  const actual = ret.actual_refund !== null ? Number(ret.actual_refund) : null;
  const estimated = ret.estimated_refund !== null ? Number(ret.estimated_refund) : null;
  const isEsc = ret.escalated || ret.ebay_status === "ESCALATED";

  // If the status explicitly says partial refund
  if (ret.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") {
    return "partial";
  }

  // If still open/active (not closed state)
  if (ret.ebay_state != null && !CLOSED_STATES.includes(ret.ebay_state)) {
    if (isEsc) return "escalated";
    return "open";
  }

  // Closed returns — classify by actual refund first
  if (actual !== null && actual > 0) {
    if (estimated !== null && estimated > 0 && actual < estimated) {
      return "partial";
    }
    return "full";
  }

  // No actual_refund data — for escalated returns, use order_total as fallback
  // Formula: implied_refund = estimated_refund - order_total
  //   order_total = 0 → Full Refund (entire amount refunded)
  //   order_total > 0 but < estimated_refund → Partial Refund
  //   order_total >= estimated_refund → No Refund
  if (isEsc) {
    const orderTotal = getOrderTotal(ret.orderTotals);
    if (orderTotal !== null) {
      if (orderTotal === 0) return "full";
      if (estimated !== null && estimated > 0 && orderTotal < estimated) return "partial";
      return "none";
    }
    // No order data available (older than 90-day sync window)
    return "escalated";
  }

  return "none";
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter ?? "all") as FilterType;

  const returns = await prisma.returns.findMany({
    include: {
      order: { include: { order_items: true } },
      listing: { select: { title: true } },
    },
    orderBy: { creation_date: "desc" },
  });

  // Enrich each return with its refund type
  const enrichedReturns = returns.map((ret) => ({
    ...ret,
    refundType: getReturnRefundType({
      ...ret,
      orderTotals: ret.order?.totals ?? null,
    }),
  }));

  // Filter groups
  const openReturns = enrichedReturns.filter((r) => r.refundType === "open");
  const closedFullRefund = enrichedReturns.filter((r) => r.refundType === "full");
  const closedPartialRefund = enrichedReturns.filter((r) => r.refundType === "partial");
  const closedNoRefund = enrichedReturns.filter((r) => r.refundType === "none");
  const escalatedReturns = enrichedReturns.filter((r) => r.refundType === "escalated");

  // Counts
  const totalReturns = enrichedReturns.length;
  const openCount = openReturns.length;
  const closedFullRefundCount = closedFullRefund.length;
  const closedPartialRefundCount = closedPartialRefund.length;
  const closedNoRefundCount = closedNoRefund.length;
  const escalatedCount = escalatedReturns.length;

  // Apply filter
  const filtered =
    filter === "open"
      ? openReturns
      : filter === "closed_full_refund"
        ? closedFullRefund
        : filter === "closed_partial_refund"
          ? closedPartialRefund
          : filter === "closed_no_refund"
            ? closedNoRefund
            : filter === "escalated"
              ? escalatedReturns
              : enrichedReturns;

  const filterLabels: Record<FilterType, string> = {
    all: "All Returns",
    open: "Open / Active Returns",
    closed_full_refund: "Closed — Full Refund",
    closed_partial_refund: "Closed — Partial Refund",
    closed_no_refund: "Closed — No Refund",
    escalated: "Escalated Returns",
  };

  const stateColors: Record<string, string> = {
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

  const cards: { key: FilterType; label: string; count: number; color: string; activeRing: string }[] = [
    { key: "all", label: "Total Returns", count: totalReturns, color: "text-slate-400", activeRing: "ring-slate-500" },
    { key: "open", label: "Open / Active", count: openCount, color: "text-yellow-400", activeRing: "ring-yellow-500" },
    { key: "closed_full_refund", label: "Closed (Full Refund)", count: closedFullRefundCount, color: "text-green-400", activeRing: "ring-green-500" },
    { key: "closed_partial_refund", label: "Closed (Partial Refund)", count: closedPartialRefundCount, color: "text-orange-400", activeRing: "ring-orange-500" },
    { key: "closed_no_refund", label: "Closed (No Refund)", count: closedNoRefundCount, color: "text-red-400", activeRing: "ring-red-500" },
    { key: "escalated", label: "Escalated", count: escalatedCount, color: "text-purple-400", activeRing: "ring-purple-500" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Returns">
        <SyncReturnsButton />
      </PageHeader>

      {/* Summary Cards — clickable filters */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.key === "all" ? "/returns" : `/returns?filter=${card.key}`}
            className={`rounded-lg border bg-slate-900 p-4 transition-all hover:bg-slate-800 cursor-pointer ${
              filter === card.key
                ? `ring-2 ${card.activeRing} border-transparent`
                : "border-slate-800"
            }`}
          >
            <p className={`text-xs ${card.color}`}>{card.label}</p>
            <p className="mt-1 text-2xl font-semibold">{card.count}</p>
          </Link>
        ))}
      </div>

      {/* Active filter indicator */}
      {filter !== "all" && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Showing: <strong className="text-slate-200">{filterLabels[filter]}</strong> ({filtered.length})</span>
          <Link href="/returns" className="text-blue-400 hover:underline text-xs">Clear filter</Link>
        </div>
      )}

      {/* Returns List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold mb-3">{filterLabels[filter]}</h2>
        <div className="space-y-3 text-sm text-slate-300">
          {filtered.length === 0 ? (
            <p className="text-slate-500">
              {enrichedReturns.length === 0
                ? 'No returns found. Click "Sync Returns & INR from eBay" to fetch data.'
                : "No returns match this filter."}
            </p>
          ) : (
            filtered.map((ret) => {
              const orderItems = ret.order?.order_items ?? [];
              const matchedItem = ret.ebay_item_id
                ? orderItems.find((i) => i.item_id === ret.ebay_item_id)
                : null;
              const displayTitle = ret.listing?.title ?? matchedItem?.title ?? (ret.ebay_item_id ? `Item ${ret.ebay_item_id}` : "Unknown Item");
              const linkItemId = ret.ebay_item_id ?? ret.item_id;

              return (
                <div key={ret.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {ret.ebay_return_id && (
                          <a
                            href={`https://www.ebay.com/rt/ReturnDetails?returnId=${ret.ebay_return_id}`}
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
                        {/* Refund type badge */}
                        {ret.refundType === "full" && (() => {
                          const orderTotal = ret.order?.totals ? getOrderTotal(ret.order.totals) : null;
                          const refundAmt = ret.actual_refund
                            ? Number(ret.actual_refund)
                            : (ret.estimated_refund && orderTotal !== null)
                              ? Number(ret.estimated_refund) - orderTotal
                              : null;
                          return (
                            <span className="rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">
                              Full Refund{refundAmt !== null ? `: $${refundAmt.toFixed(2)}` : ""}
                            </span>
                          );
                        })()}
                        {ret.refundType === "partial" && (() => {
                          const orderTotal = ret.order?.totals ? getOrderTotal(ret.order.totals) : null;
                          const refundAmt = ret.actual_refund
                            ? Number(ret.actual_refund)
                            : (ret.estimated_refund && orderTotal !== null)
                              ? Number(ret.estimated_refund) - orderTotal
                              : (ret.refund_amount ? Number(ret.refund_amount) : null);
                          const totalPaid = ret.estimated_refund ? Number(ret.estimated_refund) : null;
                          return (
                            <span className="rounded bg-orange-900 px-2 py-0.5 text-xs text-orange-300">
                              Partial Refund{refundAmt !== null ? `: $${refundAmt.toFixed(2)}` : ""}
                              {totalPaid !== null ? ` / $${totalPaid.toFixed(2)}` : ""}
                            </span>
                          );
                        })()}
                        {ret.refundType === "none" && (
                          <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                            No Refund
                          </span>
                        )}
                        {ret.refundType === "escalated" && (
                          <span className="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-300">
                            Escalated (Unknown Refund)
                          </span>
                        )}
                      </div>

                      {/* Item info with eBay link */}
                      {linkItemId && (
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`https://www.ebay.com/itm/${linkItemId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                          >
                            {displayTitle}
                          </a>
                          <a
                            href={`https://www.ebay.com/itm/${linkItemId}`}
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
                        {ret.refundType === "open" && ret.estimated_refund && (
                          <span className="text-yellow-400">
                            Est. Refund: ${Number(ret.estimated_refund).toFixed(2)} {ret.refund_currency ?? ""}
                          </span>
                        )}
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
