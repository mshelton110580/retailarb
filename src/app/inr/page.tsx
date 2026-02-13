import PageHeader from "@/components/page-header";
import SyncReturnsButton from "@/components/sync-returns-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import INRAction from "./inr-action";
import { Decimal } from "@prisma/client/runtime/library";

type FilterType = "all" | "open" | "closed_full_refund" | "closed_partial_refund" | "closed_no_refund" | "escalated" | "late";

// All statuses that indicate the case is closed (regardless of how it was closed)
const CLOSED_STATUSES = ["CLOSED", "CS_CLOSED", "OTHER"];

type INRCase = {
  ebay_status: string | null;
  claim_amount: Decimal | null;
  escalated_to_case: boolean;
  order: { order_items: { item_id: string; transaction_price: Decimal | null }[] } | null;
  ebay_item_id: string | null;
};

function isClosed(c: INRCase) {
  return c.ebay_status != null && CLOSED_STATUSES.includes(c.ebay_status);
}

function isOpen(c: INRCase) {
  if (c.ebay_status == null) return true;
  return !CLOSED_STATUSES.includes(c.ebay_status);
}

/**
 * Determine refund type for a closed case by comparing claim_amount to item price.
 * - "full": claim_amount >= transaction_price, or claim_amount > 0 with no price to compare
 * - "partial": claim_amount > 0 but less than transaction_price
 * - "none": claim_amount is null or 0
 */
function getRefundType(c: INRCase): "full" | "partial" | "none" {
  const claimAmt = Number(c.claim_amount ?? 0);
  if (claimAmt <= 0) return "none";

  // Try to find the matching order item to compare prices
  if (c.ebay_item_id && c.order?.order_items) {
    const matchedItem = c.order.order_items.find((i) => i.item_id === c.ebay_item_id);
    if (matchedItem?.transaction_price) {
      const itemPrice = Number(matchedItem.transaction_price);
      if (itemPrice > 0 && claimAmt < itemPrice) {
        return "partial";
      }
    }
  }

  // Has a claim amount but no item price to compare — treat as full refund
  return "full";
}

function isClosedFullRefund(c: INRCase) {
  return isClosed(c) && getRefundType(c) === "full";
}

function isClosedPartialRefund(c: INRCase) {
  return isClosed(c) && getRefundType(c) === "partial";
}

function isClosedNoRefund(c: INRCase) {
  return isClosed(c) && getRefundType(c) === "none";
}

function isEscalated(c: INRCase) {
  return c.escalated_to_case;
}

export default async function INRPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter ?? "all") as FilterType;

  const inrCases = await prisma.inr_cases.findMany({
    include: {
      order: { include: { order_items: true } },
      listing: { select: { title: true } },
    },
    orderBy: { created_at: "desc" },
  });

  // Build a set of all ebay_item_ids that have INR cases (for cross-referencing)
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
    // Skip if already refunded — no INR needed
    if (isOrderRefunded(shipment)) return false;
    // Skip if order already has an INR case
    if (inrOrderIds.has(shipment.order_id)) return false;
    const orderItemIds = shipment.order?.order_items?.map((i) => i.item_id) ?? [];
    for (const itemId of orderItemIds) {
      if (inrItemIds.has(itemId)) return false;
    }
    return true;
  });

  // Counts
  const totalCount = inrCases.length;
  const openCount = inrCases.filter(isOpen).length;
  const closedFullRefundCount = inrCases.filter(isClosedFullRefund).length;
  const closedPartialRefundCount = inrCases.filter(isClosedPartialRefund).length;
  const closedNoRefundCount = inrCases.filter(isClosedNoRefund).length;
  const escalatedCount = inrCases.filter(isEscalated).length;
  const lateCount = lateShipments.length;

  // Apply filter to INR cases
  const filteredCases =
    filter === "open"
      ? inrCases.filter(isOpen)
      : filter === "closed_full_refund"
        ? inrCases.filter(isClosedFullRefund)
        : filter === "closed_partial_refund"
          ? inrCases.filter(isClosedPartialRefund)
          : filter === "closed_no_refund"
            ? inrCases.filter(isClosedNoRefund)
            : filter === "escalated"
              ? inrCases.filter(isEscalated)
              : filter === "late"
                ? []
                : inrCases;

  const showLateShipments = filter === "all" || filter === "late";

  const filterLabels: Record<FilterType, string> = {
    all: "All INR Cases",
    open: "Open INR Cases",
    closed_full_refund: "Closed — Full Refund",
    closed_partial_refund: "Closed — Partial Refund",
    closed_no_refund: "Closed — No Refund",
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
    { key: "open", label: "Open", count: openCount, color: "text-yellow-400", activeRing: "ring-yellow-500" },
    { key: "closed_full_refund", label: "Closed (Full Refund)", count: closedFullRefundCount, color: "text-green-400", activeRing: "ring-green-500" },
    { key: "closed_partial_refund", label: "Closed (Partial Refund)", count: closedPartialRefundCount, color: "text-orange-400", activeRing: "ring-orange-500" },
    { key: "closed_no_refund", label: "Closed (No Refund)", count: closedNoRefundCount, color: "text-red-400", activeRing: "ring-red-500" },
    { key: "escalated", label: "Escalated", count: escalatedCount, color: "text-purple-400", activeRing: "ring-purple-500" },
    { key: "late", label: "Late (No INR)", count: lateCount, color: "text-amber-400", activeRing: "ring-amber-500" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Item Not Received (INR)">
        <SyncReturnsButton />
      </PageHeader>

      {/* Summary Cards — clickable filters */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        {cards.map((card) => (
          <Link
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
          </Link>
        ))}
      </div>

      {/* Active filter indicator */}
      {filter !== "all" && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Showing: <strong className="text-slate-200">{filterLabels[filter]}</strong> ({filter === "late" ? lateShipments.length : filteredCases.length})</span>
          <Link href="/inr" className="text-blue-400 hover:underline text-xs">Clear filter</Link>
        </div>
      )}

      {/* INR Cases */}
      {filter !== "late" && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold mb-3">{filter === "all" ? "INR Cases" : filterLabels[filter]}</h2>
          <div className="space-y-3 text-sm text-slate-300">
            {filteredCases.length === 0 ? (
              <p className="text-slate-500">
                {inrCases.length === 0
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
                const refundType = isClosed(inr) ? getRefundType(inr) : null;

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
                          {refundType === "full" && (
                            <span className="rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">
                              Full Refund: ${Number(inr.claim_amount).toFixed(2)}
                            </span>
                          )}
                          {refundType === "partial" && (
                            <span className="rounded bg-orange-900 px-2 py-0.5 text-xs text-orange-300">
                              Partial Refund: ${Number(inr.claim_amount).toFixed(2)}
                              {matchedItem?.transaction_price ? ` / $${Number(matchedItem.transaction_price).toFixed(2)}` : ""}
                            </span>
                          )}
                          {refundType === "none" && (
                            <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                              No Refund
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
                          {inr.claim_amount && !isClosed(inr) && (
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
