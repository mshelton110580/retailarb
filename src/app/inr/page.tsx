import PageHeader from "@/components/page-header";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import SyncAllButton from "@/components/sync-all-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import INRAction from "./inr-action";
import FilterLink from "@/components/filter-link";
import { Decimal } from "@prisma/client/runtime/library";
import { JsonValue } from "@prisma/client/runtime/library";

type FilterType = "all" | "open" | "open_not_escalated" | "closed_full_refund" | "closed_partial_refund" | "closed_no_refund_delivered" | "closed_no_refund_not_delivered" | "escalated" | "late";

// All statuses that indicate the case is closed (regardless of how it was closed)
const CLOSED_STATUSES = ["CLOSED", "CS_CLOSED", "OTHER"];

function isClosed(ebayStatus: string | null) {
  return ebayStatus != null && CLOSED_STATUSES.includes(ebayStatus);
}

function isOpen(ebayStatus: string | null) {
  if (ebayStatus == null) return true;
  return !CLOSED_STATUSES.includes(ebayStatus);
}

/**
 * Get the order total (listing price + shipping) from the order's totals JSON.
 * Returns null if no order or no total available.
 */
function getOrderTotal(totals: JsonValue | undefined | null): number | null {
  if (!totals) return null;
  const t = totals as { total?: string };
  if (t.total == null) return null;
  const val = Number(t.total);
  return isNaN(val) ? null : val;
}

/**
 * Determine INR refund type for a closed case.
 *
 * Key insight: eBay sets claim_amount to the remaining order balance at the
 * time the INR was filed. Comparing claim_amount to the current order_total
 * (balance after INR closure) reveals whether a refund was issued via INR:
 *
 *   order_total == 0              → full refund
 *   order_total < claim_amount    → partial refund issued during INR
 *   order_total == claim_amount   → no refund (INR closed/withdrawn without payment)
 *
 * This handles the case where a seller partial-refunded before the INR was
 * filed (reducing order_total before claim_amount was set), then the INR was
 * withdrawn — claim_amount and order_total will match, correctly → "none".
 *
 * Rules:
 * 1. If a return was also filed → item was received, no INR refund → "none"
 * 2. With both claim_amount and order_total → compare as above
 * 3. Without order data → "none" (cannot determine)
 */
function getRefundType(
  claimAmount: Decimal | null,
  orderTotals: JsonValue | undefined | null,
  hasReturn: boolean,
): "full" | "partial" | "none" {
  if (hasReturn) return "none";

  const orderTotal = getOrderTotal(orderTotals);
  const claimAmt = claimAmount !== null ? Number(claimAmount) : null;

  if (orderTotal !== null) {
    if (orderTotal === 0) return "full";
    if (claimAmt !== null && claimAmt > 0 && orderTotal < claimAmt) {
      // Order total dropped during the INR — a refund was issued
      return "partial";
    }
    return "none";
  }

  return "none";
}

export default async function INRPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter ?? "all") as FilterType;
  const dateRange = getDateRangeFromParams(params);

  const inrCases = await prisma.inr_cases.findMany({
    where: {
      created_at: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
    },
    include: {
      order: {
        include: {
          order_items: true,
          shipments: { select: { derived_status: true, delivered_at: true } },
        }
      },
      listing: { select: { title: true } },
    },
    orderBy: { created_at: "desc" },
  });

  // Fetch all returns to cross-reference with INR cases
  // An order with both INR and return means the item was received (return requires receipt)
  const allReturns = await prisma.returns.findMany({
    select: { order_id: true, ebay_item_id: true },
  });
  const returnOrderIds = new Set<string>();
  for (const ret of allReturns) {
    if (ret.order_id) returnOrderIds.add(ret.order_id);
  }

  // Enrich each INR case with refund type and delivery status
  const enrichedCases = inrCases.map((inr) => {
    const hasReturn = inr.order_id ? returnOrderIds.has(inr.order_id) : false;
    const refundType = isClosed(inr.ebay_status)
      ? getRefundType(inr.claim_amount, inr.order?.totals, hasReturn)
      : null;
    const shipment = inr.order?.shipments?.[0];
    const isDelivered = shipment?.derived_status === "delivered" || shipment?.delivered_at != null;
    return { ...inr, hasReturn, refundType, isDelivered };
  });

  // Build a set of all ebay_item_ids that have INR cases (for cross-referencing late shipments)
  const inrItemIds = new Set<string>();
  const inrOrderIds = new Set<string>();
  for (const inr of inrCases) {
    if (inr.ebay_item_id) inrItemIds.add(inr.ebay_item_id);
    if (inr.order_id) inrOrderIds.add(inr.order_id);
  }

  // Get late/not_delivered shipments (exclude canceled orders)
  const allLateShipments = await prisma.shipments.findMany({
    where: {
      derived_status: { in: ["late", "not_delivered", "not_received"] },
      order: {
        order_status: { not: "Cancelled" },
      },
    },
    include: {
      order: { include: { order_items: true } },
      tracking_numbers: true,
    },
    orderBy: { last_refreshed_at: "desc" },
  });

  // Helper: check if an order has been fully refunded (total = 0)
  const isOrderRefunded = (shipment: typeof allLateShipments[number]) => {
    const total = shipment.order?.totals as { total?: string } | null;
    return total?.total === "0.0" || total?.total === "0" || total?.total === "0.00";
  };

  // Filter out shipments where the order already has an INR case OR has been fully refunded
  const lateShipments = allLateShipments.filter((shipment) => {
    if (isOrderRefunded(shipment)) return false;
    if (inrOrderIds.has(shipment.order_id)) return false;
    const orderItemIds = shipment.order?.order_items?.map((i) => i.item_id) ?? [];
    for (const itemId of orderItemIds) {
      if (inrItemIds.has(itemId)) return false;
    }
    return true;
  });

  // Filter helpers using enriched cases
  const openCases = enrichedCases.filter((c) => isOpen(c.ebay_status));
  const openNotEscalated = enrichedCases.filter((c) => isOpen(c.ebay_status) && !c.escalated_to_case);
  const closedFullRefund = enrichedCases.filter((c) => isClosed(c.ebay_status) && c.refundType === "full");
  const closedPartialRefund = enrichedCases.filter((c) => isClosed(c.ebay_status) && c.refundType === "partial");
  const closedNoRefundDelivered = enrichedCases.filter((c) => isClosed(c.ebay_status) && c.refundType === "none" && c.isDelivered);
  const closedNoRefundNotDelivered = enrichedCases.filter((c) => isClosed(c.ebay_status) && c.refundType === "none" && !c.isDelivered);
  const escalatedCases = enrichedCases.filter((c) => c.escalated_to_case);

  // Counts
  const totalCount = enrichedCases.length;
  const openCount = openCases.length;
  const openNotEscalatedCount = openNotEscalated.length;
  const closedFullRefundCount = closedFullRefund.length;
  const closedPartialRefundCount = closedPartialRefund.length;
  const closedNoRefundDeliveredCount = closedNoRefundDelivered.length;
  const closedNoRefundNotDeliveredCount = closedNoRefundNotDelivered.length;
  const escalatedCount = escalatedCases.length;
  const lateCount = lateShipments.length;

  // Apply filter
  const filteredCases =
    filter === "open"
      ? openCases
      : filter === "open_not_escalated"
        ? openNotEscalated
        : filter === "closed_full_refund"
          ? closedFullRefund
          : filter === "closed_partial_refund"
            ? closedPartialRefund
            : filter === "closed_no_refund_delivered"
              ? closedNoRefundDelivered
              : filter === "closed_no_refund_not_delivered"
                ? closedNoRefundNotDelivered
                : filter === "escalated"
                  ? escalatedCases
                  : filter === "late"
                    ? []
                    : enrichedCases;

  const showLateShipments = filter === "all" || filter === "late";

  const filterLabels: Record<FilterType, string> = {
    all: "All INR Cases",
    open: "Open INR Cases",
    open_not_escalated: "Open — Action Required",
    closed_full_refund: "Closed — Full Refund",
    closed_partial_refund: "Closed — Partial Refund",
    closed_no_refund_delivered: "Closed — No Refund (Delivered)",
    closed_no_refund_not_delivered: "Closed — No Refund (Not Delivered)",
    escalated: "Escalated INR Cases",
    late: "Late Shipments (No INR)",
  };

  const statusColors: Record<string, string> = {
    OPEN: "bg-yellow-900 text-yellow-300",
    ON_HOLD: "bg-orange-900 text-orange-300",
    CLOSED: "bg-slate-700 text-slate-300",
    CS_CLOSED: "bg-purple-900 text-purple-300",
    OTHER: "bg-slate-700 text-slate-300",
    WAITING_FOR_SELLER_RESPONSE: "bg-red-900 text-red-300",
    WAITING_FOR_BUYER_RESPONSE: "bg-blue-900 text-blue-300",
    ESCALATED: "bg-red-900 text-red-300",
  };

  const cards: { key: FilterType; label: string; count: number; color: string; activeRing: string }[] = [
    { key: "all", label: "Total INR Cases", count: totalCount, color: "text-slate-400", activeRing: "ring-slate-500" },
    { key: "open_not_escalated", label: "Open — Action Required", count: openNotEscalatedCount, color: "text-yellow-400", activeRing: "ring-yellow-500" },
    { key: "escalated", label: "Escalated", count: escalatedCount, color: "text-purple-400", activeRing: "ring-purple-500" },
    { key: "closed_full_refund", label: "Closed (Full Refund)", count: closedFullRefundCount, color: "text-green-400", activeRing: "ring-green-500" },
    { key: "closed_partial_refund", label: "Closed (Partial Refund)", count: closedPartialRefundCount, color: "text-orange-400", activeRing: "ring-orange-500" },
    { key: "closed_no_refund_delivered", label: "Closed — No Refund (Delivered)", count: closedNoRefundDeliveredCount, color: "text-blue-400", activeRing: "ring-blue-500" },
    { key: "closed_no_refund_not_delivered", label: "Closed — No Refund (Not Delivered)", count: closedNoRefundNotDeliveredCount, color: "text-red-400", activeRing: "ring-red-500" },
    { key: "late", label: "Late (No INR)", count: lateCount, color: "text-amber-400", activeRing: "ring-amber-500" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Item Not Received (INR)">
        <SyncAllButton />
      </PageHeader>

      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{totalCount} cases</span>
      </div>

      {/* Summary Cards — clickable filters */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-8">
        {cards.map((card) => (
          <FilterLink
            key={card.key}
            href={card.key === "all" ? "/inr" : `/inr?filter=${card.key}`}
            className={`rounded-lg border bg-slate-900 p-4 transition-all hover:bg-slate-800 cursor-pointer ${
              filter === card.key
                ? `ring-2 ${card.activeRing} border-transparent`
                : "border-slate-800"
            }`}
          >
            <p className={`text-xs ${card.color}`}>{card.label}</p>
            <p className="mt-1 text-2xl font-semibold">{card.count}</p>
          </FilterLink>
        ))}
      </div>

      {/* Active filter indicator */}
      {filter !== "all" && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Showing: <strong className="text-slate-200">{filterLabels[filter]}</strong> ({filter === "late" ? lateShipments.length : filteredCases.length})</span>
          <FilterLink href="/inr" className="text-blue-400 hover:underline text-xs">Clear filter</FilterLink>
        </div>
      )}

      {/* INR Cases */}
      {filter !== "late" && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold mb-3">{filter === "all" ? "INR Cases" : filterLabels[filter]}</h2>
          <div className="space-y-3 text-sm text-slate-300">
            {filteredCases.length === 0 ? (
              <p className="text-slate-500">
                {enrichedCases.length === 0
                  ? 'No INR cases found. Click "Sync Returns & INR from eBay" to fetch data.'
                  : "No INR cases match this filter."}
              </p>
            ) : (
              filteredCases.map((inr) => {
                const orderItems = inr.order?.order_items ?? [];
                const matchedItem = inr.ebay_item_id
                  ? orderItems.find((i) => i.item_id === inr.ebay_item_id)
                  : null;
                const displayTitle = inr.listing?.title ?? matchedItem?.title ?? (inr.ebay_item_id ? `Item ${inr.ebay_item_id}` : "Unknown Item");
                const linkItemId = inr.ebay_item_id ?? inr.item_id;
                const orderTotal = getOrderTotal(inr.order?.totals);
                const claimAmt = Number(inr.claim_amount ?? 0);

                return (
                  <div key={inr.id} className="rounded border border-slate-800 p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Status badges */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {inr.ebay_inquiry_id && (
                            <a
                              href={`https://www.ebay.com/ItemNotReceived/${inr.ebay_inquiry_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-800 hover:text-amber-200 transition-colors"
                              title="View on eBay"
                            >
                              {inr.ebay_inquiry_id.startsWith("case-") ? `Case #${inr.case_id ?? inr.ebay_inquiry_id.replace("case-", "")}` : `Inquiry #${inr.ebay_inquiry_id}`} ↗
                            </a>
                          )}
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            statusColors[inr.ebay_status ?? ""] ?? "bg-slate-700 text-slate-300"
                          }`}>
                            {inr.ebay_status ?? inr.status_text ?? "Unknown"}
                          </span>
                          {inr.escalated_to_case && inr.case_id ? (
                            <a
                              href={`https://www.ebay.com/ItemNotReceived/${inr.case_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-800 hover:text-red-200 transition-colors"
                              title="View escalated case on eBay"
                            >
                              ESCALATED (Case {inr.case_id}) ↗
                            </a>
                          ) : inr.escalated_to_case ? (
                            <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                              ESCALATED
                            </span>
                          ) : null}
                          {/* Refund indicator for closed cases */}
                          {inr.refundType === "full" && (
                            <span className="rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">
                              Full Refund
                            </span>
                          )}
                          {inr.refundType === "partial" && (() => {
                            const claimAmt = inr.claim_amount ? Number(inr.claim_amount) : null;
                            const orderTotal = getOrderTotal(inr.order?.totals);
                            const refundedAmt = (claimAmt !== null && orderTotal !== null) ? claimAmt - orderTotal : null;
                            return (
                              <span className="rounded bg-orange-900 px-2 py-0.5 text-xs text-orange-300">
                                Partial Refund{refundedAmt !== null ? `: $${refundedAmt.toFixed(2)}` : ""}
                              </span>
                            );
                          })()}
                          {inr.refundType === "none" && (
                            <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                              No Refund{inr.hasReturn ? " (Item Received — Return Filed)" : ""}
                            </span>
                          )}
                          {/* Delivery status for closed no-refund INRs without a return */}
                          {inr.refundType === "none" && !inr.hasReturn && isClosed(inr.ebay_status) && (() => {
                            const shipment = inr.order?.shipments?.[0];
                            const status = shipment?.derived_status;
                            const deliveredAt = shipment?.delivered_at;
                            if (status === "delivered" || deliveredAt) {
                              return (
                                <span className="rounded bg-blue-900 px-2 py-0.5 text-xs text-blue-300">
                                  Delivered{deliveredAt ? ` ${new Date(deliveredAt).toLocaleDateString()}` : ""}
                                </span>
                              );
                            }
                            if (status === "not_received" || status === "not_delivered" || status === "shipped") {
                              return (
                                <span className="rounded bg-yellow-900 px-2 py-0.5 text-xs text-yellow-300" title="INR closed but item not yet confirmed delivered">
                                  {status === "shipped" ? "In Transit" : "Not Confirmed Delivered"}
                                </span>
                              );
                            }
                            return null;
                          })()}
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

                        {/* Order link */}
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          {inr.order_id ? (
                            <>
                              <Link href={`/orders/${inr.order_id}`} className="text-blue-400 hover:underline">
                                Order {inr.order_id}
                              </Link>
                              {inr.order?.order_url && (
                                <a
                                  href={inr.order.order_url}
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
                          {inr.buyer_login_name && <span>Buyer: {inr.buyer_login_name}</span>}
                          {inr.claim_amount && !isClosed(inr.ebay_status) && (
                            <span className="text-yellow-400">
                              Claim: ${Number(inr.claim_amount).toFixed(2)} {inr.claim_currency ?? ""}
                            </span>
                          )}
                          {inr.creation_date && (
                            <span>Created: {inr.creation_date.toISOString().slice(0, 10)}</span>
                          )}
                          {inr.respond_by_date && (
                            <span className="text-orange-400">
                              Respond by: {inr.respond_by_date.toISOString().slice(0, 10)}
                            </span>
                          )}
                          {inr.last_synced_at && (
                            <span>Synced: {inr.last_synced_at.toISOString().slice(0, 16).replace("T", " ")}</span>
                          )}
                        </div>

                        {inr.notes && (
                          <p className="mt-1 text-xs text-slate-500 italic">Notes: {inr.notes}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Late Shipments Without INR */}
      {showLateShipments && lateShipments.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold mb-3">Late Shipments — Consider Filing INR</h2>
          <p className="text-xs text-slate-500 mb-3">
            These shipments are late or not delivered and don&apos;t have an INR case yet.
          </p>
          <div className="space-y-3 text-sm text-slate-300">
            {lateShipments.map((shipment) => (
              <div key={shipment.id} className="rounded border border-slate-800 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300">
                        {shipment.derived_status}
                      </span>
                    </div>

                    {/* Order items with eBay links */}
                    {shipment.order?.order_items?.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-xs mb-1">
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                        >
                          {item.title}
                        </a>
                        <span className="text-slate-500">x{item.qty}</span>
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400"
                          title="Open item on eBay"
                        >
                          ↗
                        </a>
                      </div>
                    ))}

                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                      <Link href={`/orders/${shipment.order_id}`} className="text-blue-400 hover:underline">
                        Order {shipment.order_id}
                      </Link>
                      {shipment.order?.order_url && (
                        <a
                          href={shipment.order.order_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400"
                        >
                          eBay Order ↗
                        </a>
                      )}
                      {shipment.tracking_numbers?.map((tn) => (
                        <span key={tn.id} className="text-slate-500">
                          {tn.carrier}: {tn.tracking_number}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <INRAction orderId={shipment.order_id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
