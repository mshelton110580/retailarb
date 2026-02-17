import PageHeader from "@/components/page-header";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import FilterLink from "@/components/filter-link";
import { prisma } from "@/lib/db";
import Link from "next/link";

type BucketKey =
  | "total_orders"
  | "delivered"
  | "shipped"
  | "checked_in"
  | "not_checked_in"
  | "never_shipped"
  | "overdue_not_received"
  | "delivered_not_checked_in"
  | "cancelled"
  | "needs_return"
  | "missing_units"
  | "check_quantity"
  | "ebay_returns"
  | "ebay_inr"
  | "return_filed_awaiting_response"
  | "return_print_label"
  | "return_label_printed"
  | "return_in_transit"
  | "return_delivered"
  | "return_refunded";

const cardConfig: Array<{
  key: BucketKey;
  label: string;
  color: string;
  border: string;
  description?: string;
  section?: string;
  linkTo?: string;
}> = [
  // Primary delivery status
  { key: "total_orders", label: "Total Orders", color: "text-white", border: "border-slate-500", section: "primary" },
  { key: "cancelled", label: "Cancelled & Refunded", color: "text-slate-400", border: "border-slate-600", description: "Order cancelled on eBay, refunded (not actionable)", section: "primary" },
  { key: "delivered", label: "Delivered", color: "text-green-400", border: "border-green-600", description: "eBay confirms delivery", section: "primary" },
  { key: "shipped", label: "Shipped", color: "text-blue-400", border: "border-blue-600", description: "Tracking uploaded, not yet delivered", section: "primary" },
  // Warehouse status
  { key: "checked_in", label: "Checked In", color: "text-emerald-400", border: "border-emerald-600", description: "Scanned at warehouse", section: "warehouse" },
  { key: "not_checked_in", label: "Not Checked In", color: "text-yellow-400", border: "border-yellow-600", description: "Not yet scanned at warehouse", section: "warehouse" },
  // Action items
  { key: "delivered_not_checked_in", label: "Delivered — Not Checked In", color: "text-purple-400", border: "border-purple-600", description: "eBay says delivered but not scanned at warehouse — possible return to sender", section: "action" },
  { key: "never_shipped", label: "Never Shipped", color: "text-rose-400", border: "border-rose-600", description: "No tracking info uploaded (excludes cancelled)", section: "action" },
  { key: "overdue_not_received", label: "Overdue — Not Received", color: "text-amber-400", border: "border-amber-600", description: "Has tracking, past estimated delivery, no delivery confirmation", section: "action" },
  { key: "needs_return", label: "Needs Return", color: "text-red-400", border: "border-red-600", description: "Checked in with bad condition", section: "action" },
  { key: "missing_units", label: "Missing Units", color: "text-orange-400", border: "border-orange-600", description: "Scanned fewer units than expected quantity", section: "action" },
  { key: "check_quantity", label: "Check Quantity (Lots)", color: "text-fuchsia-400", border: "border-fuchsia-600", description: "More units scanned than listed qty — verify lot count", section: "action" },
  // eBay Cases
  { key: "ebay_returns", label: "eBay Returns", color: "text-red-400", border: "border-red-600", description: "Return requests synced from eBay", section: "cases", linkTo: "/returns" },
  { key: "ebay_inr", label: "eBay INR Cases", color: "text-amber-400", border: "border-amber-600", description: "Item Not Received inquiries from eBay", section: "cases", linkTo: "/inr" },
  // Return Tracking Status
  { key: "return_filed_awaiting_response", label: "Return Filed — Awaiting Response", color: "text-orange-300", border: "border-orange-500", description: "Return filed, waiting for seller to respond or provide label", section: "return_tracking" },
  { key: "return_print_label", label: "Return Label Ready — Print", color: "text-yellow-300", border: "border-yellow-500", description: "Return label created, needs to be printed", section: "return_tracking" },
  { key: "return_label_printed", label: "Return Label Printed", color: "text-lime-300", border: "border-lime-500", description: "Return label printed, ready to ship", section: "return_tracking" },
  { key: "return_in_transit", label: "Return In Transit", color: "text-cyan-300", border: "border-cyan-500", description: "Return package shipped and in transit to seller", section: "return_tracking" },
  { key: "return_delivered", label: "Return Delivered", color: "text-sky-300", border: "border-sky-500", description: "Return delivered to seller, awaiting refund", section: "return_tracking" },
  { key: "return_refunded", label: "Return Refunded", color: "text-emerald-300", border: "border-emerald-500", description: "Return completed and refund issued", section: "return_tracking" },
];

export default async function InventoryPage({
  searchParams
}: {
  searchParams: { filter?: string; range?: string; from?: string; to?: string };
}) {
  const activeFilter = (searchParams.filter ?? null) as BucketKey | null;
  const dateRange = getDateRangeFromParams(searchParams);

  // Fetch all shipments with order + items, filtered by order purchase_date
  const shipments = await prisma.shipments.findMany({
    where: {
      order: {
        purchase_date: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      },
    },
    include: {
      order: {
        include: {
          order_items: true
        }
      },
      tracking_numbers: true
    }
  });

  // Fetch received units with condition
  const receivedUnits = await prisma.received_units.findMany({
    select: { order_id: true, item_id: true, condition_status: true }
  });

  // Fetch returns and INR cases (filtered by order purchase_date OR creation_date to match date range)
  const [returns, inrCases, returnCount, openReturnCount, inrCount, openInrCount] = await Promise.all([
    // Fetch all returns with tracking data
    prisma.returns.findMany({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
      },
      select: {
        order_id: true,
        ebay_state: true,
        ebay_status: true,
        label_created_date: true,
        label_url: true,
        label_pdf_path: true,
        return_tracking_number: true,
        return_tracking_status: true,
        return_shipped_date: true,
        return_delivered_date: true,
        refund_issued_date: true,
        actual_refund: true,
        respond_by_date: true,
      },
    }),
    // Fetch all INR cases to get order IDs with filed INR cases
    prisma.inr_cases.findMany({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
      },
      select: { order_id: true },
    }),
    // Return counts
    prisma.returns.count({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
      },
    }),
    prisma.returns.count({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
        AND: [
          {
            OR: [
              { ebay_state: { notIn: ["RETURN_CLOSED", "REFUND_ISSUED"] } },
              { ebay_state: null, scrape_state: { not: "COMPLETE" } },
            ],
          },
        ],
      },
    }),
    prisma.inr_cases.count({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
      },
    }),
    prisma.inr_cases.count({
      where: {
        OR: [
          {
            order: {
              purchase_date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            },
          },
          {
            AND: [
              { order_id: null },
              {
                creation_date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              },
            ],
          },
        ],
        AND: [
          {
            OR: [
              { ebay_status: { not: "CLOSED" } },
              { ebay_status: null },
            ],
          },
        ],
      },
    }),
  ]);

  const receivedOrderIds = new Set(receivedUnits.map((u) => u.order_id));
  const goodConditions = new Set(["good", "new", "like_new", "like new", "acceptable", "excellent", "GOOD", "NEW", "LIKE_NEW", "ACCEPTABLE", "EXCELLENT"]);
  const needsReturnOrderIds = new Set(
    receivedUnits
      .filter((u) => u.condition_status && !goodConditions.has(u.condition_status))
      .map((u) => u.order_id)
  );

  // Create sets of order IDs with filed returns or INR cases
  const orderIdsWithReturns = new Set(returns.map((r) => r.order_id).filter((id): id is string => id !== null));
  const orderIdsWithINR = new Set(inrCases.map((i) => i.order_id).filter((id): id is string => id !== null));

  // Categorize shipments into buckets
  const buckets: Record<BucketKey, typeof shipments> = {
    total_orders: [],
    delivered: [],
    shipped: [],
    checked_in: [],
    not_checked_in: [],
    delivered_not_checked_in: [],
    cancelled: [],
    never_shipped: [],
    overdue_not_received: [],
    needs_return: [],
    return_filed_awaiting_response: [],
    return_print_label: [],
    return_label_printed: [],
    return_in_transit: [],
    return_delivered: [],
    return_refunded: [],
    missing_units: [],
    check_quantity: [],
    ebay_returns: [],
    ebay_inr: [],
  };

  const now = new Date();
  const DEFAULT_TRANSIT_DAYS = 7;

  for (const shipment of shipments) {
    const orderId = shipment.order_id;
    const hasTracking = (shipment.tracking_numbers?.length ?? 0) > 0;
    const isDelivered = Boolean(shipment.delivered_at);
    const isCheckedIn = Boolean(shipment.checked_in_at);
    const isCancelled = shipment.order?.order_status === "Cancelled";
    const isRefunded = shipment.order?.totals && typeof shipment.order.totals === 'object' && 'total' in shipment.order.totals && Number(shipment.order.totals.total) === 0;

    // Total orders — every shipment
    buckets.total_orders.push(shipment);

    // === PRIMARY STATUS (mutually exclusive) ===
    // Only categorize as cancelled/refunded if no return or INR case has been filed
    if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
      buckets.cancelled.push(shipment);
    } else if (isDelivered) {
      buckets.delivered.push(shipment);
    } else if (hasTracking) {
      buckets.shipped.push(shipment);
    }

    // === WAREHOUSE STATUS (mutually exclusive, excludes cancelled) ===
    if (!isCancelled) {
      if (isCheckedIn) {
        buckets.checked_in.push(shipment);
      } else {
        buckets.not_checked_in.push(shipment);
      }
    }

    // === ACTION ITEMS ===

    // Never shipped: no tracking, not delivered, not cancelled/refunded, no INR case filed
    if (!hasTracking && !isDelivered && !isCancelled && !isRefunded && !orderIdsWithINR.has(orderId)) {
      buckets.never_shipped.push(shipment);
    }

    // Overdue: has tracking, no delivery, past expected date, not cancelled/refunded, no INR case filed
    if (!isCancelled && !isRefunded && !orderIdsWithINR.has(orderId)) {
      let expectedBy: Date | null = null;
      if (shipment.estimated_max) {
        expectedBy = new Date(shipment.estimated_max);
      } else if (shipment.order?.purchase_date) {
        expectedBy = new Date(shipment.order.purchase_date);
        expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
      }
      if (hasTracking && !isDelivered && expectedBy && now > expectedBy) {
        buckets.overdue_not_received.push(shipment);
      }
    }

    // Delivered but not checked in
    if (isDelivered && !isCheckedIn && !isCancelled) {
      buckets.delivered_not_checked_in.push(shipment);
    }

    // Needs return: checked in with bad condition, but no return filed yet
    if (needsReturnOrderIds.has(orderId) && !orderIdsWithReturns.has(orderId)) {
      buckets.needs_return.push(shipment);
    }

    // Missing units
    if (shipment.scan_status === "partial" && shipment.scanned_units < shipment.expected_units) {
      buckets.missing_units.push(shipment);
    }

    // Check quantity (lots)
    if (shipment.is_lot || shipment.scan_status === "check_quantity") {
      buckets.check_quantity.push(shipment);
    }
  }

  // === RETURN TRACKING CATEGORIZATION ===
  // Categorize returns based on their tracking status
  for (const returnCase of returns) {
    if (!returnCase.order_id) continue; // Skip returns without linked orders

    // Find matching shipment
    const shipment = shipments.find(s => s.order_id === returnCase.order_id);
    if (!shipment) continue;

    // 1. Return Refunded (final state)
    if (returnCase.refund_issued_date || returnCase.actual_refund) {
      buckets.return_refunded.push(shipment);
      continue;
    }

    // 2. Return Delivered (waiting for refund)
    if (returnCase.return_delivered_date) {
      buckets.return_delivered.push(shipment);
      continue;
    }

    // 3. Return In Transit (tracking shows in transit)
    if (returnCase.return_shipped_date ||
        (returnCase.return_tracking_number && returnCase.return_tracking_status &&
         returnCase.return_tracking_status !== "DELIVERED")) {
      buckets.return_in_transit.push(shipment);
      continue;
    }

    // 4. Label Printed (label downloaded/printed but not shipped yet)
    if (returnCase.label_pdf_path && !returnCase.return_shipped_date) {
      buckets.return_label_printed.push(shipment);
      continue;
    }

    // 5. Print Label (label created/ready but not printed)
    if ((returnCase.label_created_date || returnCase.label_url) && !returnCase.label_pdf_path) {
      buckets.return_print_label.push(shipment);
      continue;
    }

    // 6. Filed - Awaiting Response (return filed but no label yet)
    if (returnCase.ebay_state || returnCase.ebay_status) {
      // Check if waiting for response (no label available yet)
      const isWaitingForLabel = !returnCase.label_created_date && !returnCase.label_url;
      const isBeforeDeadline = returnCase.respond_by_date ? new Date(returnCase.respond_by_date) > now : true;

      if (isWaitingForLabel && isBeforeDeadline) {
        buckets.return_filed_awaiting_response.push(shipment);
      }
    }
  }

  const isReturnTrackingFilter = activeFilter?.startsWith("return_");
  const filteredItems = activeFilter && activeFilter !== "ebay_returns" && activeFilter !== "ebay_inr"
    ? buckets[activeFilter] ?? []
    : [];

  // Group cards by section
  const primaryCards = cardConfig.filter((c) => c.section === "primary");
  const warehouseCards = cardConfig.filter((c) => c.section === "warehouse");
  const actionCards = cardConfig.filter((c) => c.section === "action");
  const caseCards = cardConfig.filter((c) => c.section === "cases");
  const returnTrackingCards = cardConfig.filter((c) => c.section === "return_tracking");

  // Override counts for eBay cases (they're not shipment-based)
  const countOverrides: Partial<Record<BucketKey, number>> = {
    ebay_returns: returnCount,
    ebay_inr: inrCount,
  };

  function renderCards(cards: typeof cardConfig) {
    return cards.map((card) => {
      const count = countOverrides[card.key] ?? buckets[card.key].length;
      const isActive = activeFilter === card.key;

      // For case cards, link to their dedicated pages
      if (card.linkTo) {
        return (
          <Link
            key={card.key}
            href={card.linkTo}
            className={`rounded-lg border p-4 transition-colors hover:bg-slate-800 cursor-pointer ${card.border} bg-slate-900`}
          >
            <p className={`text-sm ${card.color}`}>{card.label}</p>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
            {card.description && (
              <p className="mt-1 text-xs text-slate-500">{card.description}</p>
            )}
          </Link>
        );
      }

      return (
        <FilterLink
          key={card.key}
          href={isActive ? "/inventory" : `/inventory?filter=${card.key}`}
          className={`rounded-lg border p-4 transition-colors hover:bg-slate-800 cursor-pointer ${
            isActive ? `${card.border} bg-slate-800` : "border-slate-800 bg-slate-900"
          }`}
        >
          <p className={`text-sm ${card.color}`}>{card.label}</p>
          <p className="mt-2 text-2xl font-semibold">{count}</p>
          {card.description && (
            <p className="mt-1 text-xs text-slate-500">{card.description}</p>
          )}
        </FilterLink>
      );
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Dashboard" />

      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{buckets.total_orders.length} orders</span>
      </div>

      {/* Primary Delivery Status */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Delivery Status</h2>
        <p className="mb-3 text-xs text-slate-600">Delivered + Shipped + Cancelled + Never Shipped = Total Orders</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(primaryCards)}
        </div>
      </div>

      {/* Warehouse Status */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Warehouse Status</h2>
        <p className="mb-3 text-xs text-slate-600">Checked In + Not Checked In = Total Orders (excluding cancelled)</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(warehouseCards)}
        </div>
      </div>

      {/* Action Items */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Action Items</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(actionCards)}
        </div>
      </div>

      {/* eBay Cases */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">eBay Cases</h2>
        <p className="mb-3 text-xs text-slate-600">Returns and INR inquiries synced from eBay Post-Order API</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(caseCards)}
        </div>
      </div>

      {/* Return Tracking */}
      {returnTrackingCards.some(card => buckets[card.key].length > 0) && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Return Tracking</h2>
          <p className="mb-3 text-xs text-slate-600">Real-time return status from eBay Post-Order API</p>
          <div className="grid gap-4 md:grid-cols-4">
            {renderCards(returnTrackingCards)}
          </div>
        </div>
      )}

      {activeFilter && activeFilter !== "ebay_returns" && activeFilter !== "ebay_inr" && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            {cardConfig.find((c) => c.key === activeFilter)?.label ?? activeFilter} ({filteredItems.length})
          </h2>
          <div className="space-y-2 text-sm text-slate-300">
            {filteredItems.length === 0 ? (
              <p>No items in this category.</p>
            ) : (
              filteredItems.map((shipment) => (
                <div key={shipment.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-center justify-between">
                    <Link className="font-medium text-blue-400" href={`/orders/${shipment.order_id}`}>
                      Order {shipment.order_id}
                    </Link>
                    <div className="flex gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        shipment.order?.order_status === 'Cancelled' ? 'bg-slate-700 text-slate-300' :
                        shipment.delivered_at ? 'bg-green-900 text-green-300' :
                        (shipment.tracking_numbers?.length ?? 0) > 0 ? 'bg-blue-900 text-blue-300' :
                        'bg-rose-900 text-rose-300'
                      }`}>
                        {shipment.order?.order_status === 'Cancelled' ? 'Cancelled' :
                         shipment.delivered_at ? 'Delivered' :
                         (shipment.tracking_numbers?.length ?? 0) > 0 ? 'Shipped' :
                         'Never Shipped'}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${shipment.checked_in_at ? 'bg-emerald-900 text-emerald-300' : 'bg-yellow-900 text-yellow-300'}`}>
                        {shipment.checked_in_at ? `Checked in: ${shipment.checked_in_at.toISOString().slice(0, 10)}` : 'Not checked in'}
                      </span>
                    </div>
                  </div>
                  {shipment.order?.order_items?.map((item) => (
                    <div key={item.id} className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <a
                        href={`https://www.ebay.com/itm/${item.item_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                        title={item.title ?? "View on eBay"}
                      >
                        {item.title ?? `Item ${item.item_id}`}
                      </a>
                      <span>(x{item.qty})</span>
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
                  {/* Scan progress */}
                  {shipment.scanned_units > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              shipment.is_lot ? 'bg-fuchsia-500' :
                              shipment.scanned_units >= shipment.expected_units ? 'bg-green-500' : 'bg-yellow-500'
                            }`}
                            style={{ width: `${Math.min(100, shipment.expected_units > 0 ? (shipment.scanned_units / shipment.expected_units) * 100 : 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {shipment.is_lot
                            ? `Lot: ${shipment.scanned_units} scanned (listed: ${shipment.expected_units})`
                            : `${shipment.scanned_units}/${shipment.expected_units} units scanned`}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="mt-1 flex gap-3 text-xs text-slate-500">
                    {shipment.tracking_numbers?.map((tn) => (
                      <span key={tn.id}>{tn.carrier}: {tn.tracking_number}</span>
                    ))}
                    {shipment.delivered_at && (
                      <span>Delivered: {shipment.delivered_at.toISOString().slice(0, 10)}</span>
                    )}
                    {shipment.estimated_max && !shipment.delivered_at && (
                      <span>Est. delivery: {shipment.estimated_max.toISOString().slice(0, 10)}</span>
                    )}
                    {shipment.order?.purchase_date && (
                      <span>Purchased: {shipment.order.purchase_date.toISOString().slice(0, 10)}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
