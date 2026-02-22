import PageHeader from "@/components/page-header";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import FilterLink from "@/components/filter-link";
import { prisma } from "@/lib/db";
import Link from "next/link";
import SyncAllButton from "@/components/sync-all-button";
import CheckQuantityPanel from "@/components/check-quantity-panel";

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
  | "reviewed_lots"
  | "ebay_returns"
  | "ebay_inr"
  | "contact_seller"
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
  { key: "shipped", label: "In Transit", color: "text-blue-400", border: "border-blue-600", description: "Has tracking, within expected delivery window, not refunded", section: "primary" },
  // Warehouse status
  { key: "checked_in", label: "Checked In", color: "text-emerald-400", border: "border-emerald-600", description: "Scanned at warehouse", section: "warehouse" },
  { key: "not_checked_in", label: "Not Checked In", color: "text-yellow-400", border: "border-yellow-600", description: "Not yet scanned at warehouse (includes cancelled orders)", section: "warehouse" },
  // Action items
  { key: "delivered_not_checked_in", label: "Delivered — Not Checked In", color: "text-purple-400", border: "border-purple-600", description: "eBay says delivered but not scanned at warehouse — possible return to sender", section: "action" },
  { key: "never_shipped", label: "Never Shipped", color: "text-rose-400", border: "border-rose-600", description: "No tracking info uploaded (excludes cancelled)", section: "action" },
  { key: "overdue_not_received", label: "Overdue — Not Received", color: "text-amber-400", border: "border-amber-600", description: "Has tracking, past estimated delivery, no delivery confirmation", section: "action" },
  { key: "needs_return", label: "Needs Return", color: "text-red-400", border: "border-red-600", description: "Checked in with bad condition", section: "action" },
  { key: "contact_seller", label: "Contact Seller", color: "text-sky-400", border: "border-sky-600", description: "Keeping item but condition notes were recorded — contact seller about the issue (excludes orders with returns filed)", section: "action" },
  { key: "missing_units", label: "Missing Units", color: "text-orange-400", border: "border-orange-600", description: "Scanned fewer units than expected quantity", section: "action" },
  { key: "check_quantity", label: "Check Quantity (Lots)", color: "text-fuchsia-400", border: "border-fuchsia-600", description: "Lots pending review — verify lot count", section: "action" },
  // Completed actions
  { key: "reviewed_lots", label: "Reviewed Lots", color: "text-green-400", border: "border-green-600", description: "Lots that have been reviewed and reconciled", section: "completed" },
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

  // Fetch received units with condition and notes
  const receivedUnits = await prisma.received_units.findMany({
    select: { order_id: true, item_id: true, condition_status: true, inventory_state: true, notes: true, received_at: true, images: { select: { id: true, image_path: true } } }
  });

  // Get all order IDs from shipments for return/INR lookups
  const shipmentOrderIds = shipments.map(s => s.order_id).filter((id): id is string => id !== null);

  // Fetch returns and INR cases (filtered by order purchase_date OR creation_date to match date range)
  const [returns, inrCases, returnCount, openReturnCount, inrCount, openInrCount] = await Promise.all([
    // Fetch ALL returns for these orders (not date-filtered) to correctly determine "truly cancelled"
    prisma.returns.findMany({
      where: {
        order_id: {
          in: shipmentOrderIds
        }
      },
      select: {
        id: true,
        order_id: true,
        ebay_return_id: true,
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
        estimated_refund: true,
        escalated: true,
        respond_by_date: true,
      },
    }),
    // Fetch ALL INR cases for these orders (not date-filtered) to correctly determine "truly cancelled"
    prisma.inr_cases.findMany({
      where: {
        order_id: {
          in: shipmentOrderIds
        }
      },
      select: {
        order_id: true,
        ebay_status: true,
        ebay_state: true
      },
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
  const goodConditions = new Set(["good", "new", "like_new", "like new", "acceptable", "excellent"]);

  // Needs return: has at least one unit with inventory_state === 'to_be_returned'
  // (bad condition + no return filed yet — set by sync/import logic)
  const needsReturnOrderIds = new Set(
    receivedUnits
      .filter((u) => u.inventory_state === "to_be_returned")
      .map((u) => u.order_id)
  );
  // Orders with any bad condition unit (for contact_seller exclusion)
  const badConditionOrderIds = new Set(
    receivedUnits
      .filter((u) => {
        const c = u.condition_status?.toLowerCase() ?? "";
        return c && !goodConditions.has(c);
      })
      .map((u) => u.order_id)
  );
  // Contact Seller: condition is good (keeping the item) but there are condition notes to report
  const contactSellerOrderIds = new Set(
    receivedUnits
      .filter((u) => {
        const c = u.condition_status?.toLowerCase() ?? "";
        return goodConditions.has(c) && u.notes?.trim();
      })
      .map((u) => u.order_id)
  );

  // Build map from order_id -> received units (for detail display)
  const unitsByOrderId = new Map<string, typeof receivedUnits>();
  for (const u of receivedUnits) {
    if (!u.order_id) continue;
    if (!unitsByOrderId.has(u.order_id)) unitsByOrderId.set(u.order_id, []);
    unitsByOrderId.get(u.order_id)!.push(u);
  }

  // Create sets of order IDs with filed returns or INR cases
  // For returns: only include open returns (not closed/refunded)
  const orderIdsWithReturns = new Set(
    returns
      .filter((r) => {
        // Exclude closed returns
        if (r.ebay_state === "CLOSED" || r.ebay_state === "RETURN_CLOSED" || r.ebay_state === "REFUND_ISSUED") {
          return false;
        }
        if (r.ebay_status === "CLOSED" || r.ebay_status === "REFUND_ISSUED" || r.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") {
          return false;
        }
        return true;
      })
      .map((r) => r.order_id)
      .filter((id): id is string => id !== null)
  );

  // For INR: only include open cases (not closed)
  const orderIdsWithINR = new Set(
    inrCases
      .filter((i) => i.ebay_status !== "CLOSED" && i.ebay_state !== "CLOSED")
      .map((i) => i.order_id)
      .filter((id): id is string => id !== null)
  );

  // Create map from order_id to eBay return ID for linking
  const orderToReturnId = new Map<string, string>();
  for (const ret of returns) {
    if (ret.order_id && ret.ebay_return_id) {
      orderToReturnId.set(ret.order_id, ret.ebay_return_id);
    }
  }

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
    contact_seller: [],
    return_filed_awaiting_response: [],
    return_print_label: [],
    return_label_printed: [],
    return_in_transit: [],
    return_delivered: [],
    return_refunded: [],
    missing_units: [],
    check_quantity: [],
    reviewed_lots: [],
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

    // === PRIMARY STATUS (mutually exclusive and exhaustive) ===
    // IMPORTANT: Every shipment must fall into exactly ONE of these categories
    // Order matters: check most definitive states first
    if (isDelivered) {
      buckets.delivered.push(shipment);
    } else if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
      // Cancelled/refunded with no open return/INR case
      buckets.cancelled.push(shipment);
    } else if (hasTracking && !isCancelled && !isRefunded) {
      // "In Transit" = has tracking, not delivered, not cancelled/refunded, within expected delivery window
      // Calculate expected delivery date
      let expectedBy: Date | null = null;
      if (shipment.estimated_max) {
        expectedBy = new Date(shipment.estimated_max);
      } else if (shipment.order?.purchase_date) {
        expectedBy = new Date(shipment.order.purchase_date);
        expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
      }

      // Only count as "shipped/in transit" if within expected delivery window
      if (!expectedBy || now <= expectedBy) {
        buckets.shipped.push(shipment);
      } else {
        // Has tracking but past expected delivery → goes to "never shipped" catchall
        // (will be caught by "Overdue" action item)
        buckets.never_shipped.push(shipment);
      }
    } else {
      // Everything else = never shipped (catchall ensures exhaustiveness)
      // Includes: true never shipped, refunded with open INR/return, overdue shipments
      buckets.never_shipped.push(shipment);
    }

    // === WAREHOUSE STATUS ===
    // All shipments appear here — cancelled orders that haven't been checked in
    // still need to be accounted for (item may still arrive or need processing).
    // Only exclude: truly cancelled orders that ARE already checked in (already handled).
    if (isCheckedIn) {
      buckets.checked_in.push(shipment);
    } else {
      buckets.not_checked_in.push(shipment);
    }

    // === ACTION ITEMS ===

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
    if (isDelivered && !isCheckedIn) {
      buckets.delivered_not_checked_in.push(shipment);
    }

    // Needs return: has units with inventory_state=to_be_returned (bad condition, no return filed yet)
    // The to_be_returned state already excludes orders with returns filed — but also exclude
    // if a return was filed since the last sync (open return in orderIdsWithReturns)
    if (needsReturnOrderIds.has(orderId) && !orderIdsWithReturns.has(orderId)) {
      buckets.needs_return.push(shipment);
    }

    // Contact seller: good condition but has condition notes — keeping the item, seller should be notified
    // Exclude orders with any return filed (open or closed) — handled via eBay returns process
    const hasAnyReturn = returns.some((r) => r.order_id === orderId);
    if (contactSellerOrderIds.has(orderId) && !badConditionOrderIds.has(orderId) && !hasAnyReturn) {
      buckets.contact_seller.push(shipment);
    }

    // Missing units
    if (shipment.scan_status === "partial" && shipment.scanned_units < shipment.expected_units) {
      buckets.missing_units.push(shipment);
    }

    // Check quantity (lots) — split by review status
    if (shipment.is_lot || shipment.scan_status === "check_quantity") {
      const reconcStatus = (shipment as any).reconciliation_status ?? "pending";
      if (reconcStatus === "reviewed" || reconcStatus === "overridden") {
        buckets.reviewed_lots.push(shipment);
      } else {
        buckets.check_quantity.push(shipment);
      }
    }
  }

  // === RETURN TRACKING CATEGORIZATION ===
  // Helper function to determine if return is closed (matches returns page logic)
  // IMPORTANT: A closed return should NEVER appear in "Awaiting Response"
  // Closed returns go to "Refunded" category (full, partial, or no refund)
  const CLOSED_STATES = ["CLOSED"];

  function isReturnClosed(ret: typeof returns[0]): boolean {
    // Check for CLOSED state or status
    if (ret.ebay_state && CLOSED_STATES.includes(ret.ebay_state)) {
      return true;
    }

    if (ret.ebay_status && CLOSED_STATES.includes(ret.ebay_status)) {
      return true;
    }

    // These states also indicate closure
    if (ret.ebay_state === "REFUND_ISSUED" || ret.ebay_state === "RETURN_CLOSED") {
      return true;
    }

    // Explicit refund statuses mean it's closed
    if (ret.ebay_status === "REFUND_ISSUED" || ret.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") {
      return true;
    }

    return false;
  }

  // Categorize returns based on their tracking status
  for (const returnCase of returns) {
    if (!returnCase.order_id) continue; // Skip returns without linked orders

    // Find matching shipment
    const shipment = shipments.find(s => s.order_id === returnCase.order_id);
    if (!shipment) continue;

    // Define helper flags for clearer logic
    const hasLabel = !!(returnCase.label_created_date || returnCase.label_url);
    const hasLabelPdf = !!returnCase.label_pdf_path;
    const hasTracking = !!returnCase.return_tracking_number;
    const isShipped = !!returnCase.return_shipped_date;
    const isDelivered = !!returnCase.return_delivered_date;
    const isClosed = isReturnClosed(returnCase);

    // Check status/state for implicit label availability
    const statusIndicatesLabelReady =
      returnCase.ebay_status === "READY_FOR_SHIPPING" ||
      returnCase.ebay_state === "ITEM_READY_TO_SHIP" ||
      returnCase.ebay_state === "RETURN_SHIPPED";

    // 1. FIRST PRIORITY: Closed returns (full/partial/no refund - anything closed goes here)
    // This prevents closed returns from appearing in "Awaiting Response"
    if (isClosed) {
      buckets.return_refunded.push(shipment);
      continue;
    }

    // 2. Return Delivered (waiting for refund)
    if (isDelivered) {
      buckets.return_delivered.push(shipment);
      continue;
    }

    // 3. Return In Transit (tracking shows in transit)
    if (isShipped || (hasTracking && returnCase.return_tracking_status && returnCase.return_tracking_status !== "DELIVERED")) {
      buckets.return_in_transit.push(shipment);
      continue;
    }

    // 4. Label Printed (label downloaded/printed but not shipped yet)
    if (hasLabelPdf && !isShipped) {
      buckets.return_label_printed.push(shipment);
      continue;
    }

    // 5. Print Label (label created/ready but not downloaded/printed yet)
    // Include returns where eBay status indicates label is ready even if API didn't return label URL
    if ((hasLabel || statusIndicatesLabelReady) && !hasLabelPdf && !isShipped) {
      buckets.return_print_label.push(shipment);
      continue;
    }

    // 6. Filed - Awaiting Response (return filed but NOTHING else has happened)
    // ONLY if: has ebay_state/status AND no label AND no tracking AND not shipped
    if ((returnCase.ebay_state || returnCase.ebay_status) && !hasLabel && !hasTracking && !isShipped) {
      buckets.return_filed_awaiting_response.push(shipment);
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
  const completedCards = cardConfig.filter((c) => c.section === "completed");
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
      <PageHeader title="Inventory Dashboard">
        <SyncAllButton />
      </PageHeader>

      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{buckets.total_orders.length} orders</span>
      </div>

      {/* Primary Delivery Status */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Delivery Status</h2>
        <p className="mb-3 text-xs text-slate-600">Delivered + In Transit + Cancelled + Never Shipped = Total Orders</p>
        <div className="grid gap-4 md:grid-cols-4">
          {renderCards(primaryCards)}
        </div>
      </div>

      {/* Warehouse Status */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Warehouse Status</h2>
        <p className="mb-3 text-xs text-slate-600">Checked In + Not Checked In = Total Orders</p>
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

      {/* Completed Actions */}
      {completedCards.some((c) => buckets[c.key as BucketKey].length > 0) && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-400 uppercase tracking-wider">Completed Actions</h2>
          <div className="grid gap-4 md:grid-cols-4">
            {renderCards(completedCards)}
          </div>
        </div>
      )}

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

          {/* Lot reconciliation — replaces generic drilldown for check_quantity and reviewed_lots */}
          {(activeFilter === "check_quantity" || activeFilter === "reviewed_lots") ? (
            <CheckQuantityPanel
              shipments={filteredItems.map((s) => ({
                id: s.id,
                order_id: s.order_id,
                scanned_units: s.scanned_units,
                expected_units: s.expected_units,
                is_lot: s.is_lot,
                lot_size: (s as any).lot_size ?? null,
                reconciliation_status: (s as any).reconciliation_status ?? "pending",
                items: (s.order?.order_items ?? []).map((i: any) => ({
                  title: i.title,
                  qty: i.qty,
                  itemId: i.item_id,
                })),
              }))}
            />
          ) : (
          <div className="space-y-2 text-sm text-slate-300">
            {filteredItems.length === 0 ? (
              <p>No items in this category.</p>
            ) : (
              filteredItems.map((shipment) => {
                const orderUnits = unitsByOrderId.get(shipment.order_id) ?? [];
                return (
                  <div key={shipment.id} className="rounded border border-slate-800 p-3">
                    {/* Order header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Link className="font-medium text-blue-400" href={`/orders/${shipment.order_id}`}>
                          Order {shipment.order_id}
                        </Link>
                        {orderToReturnId.has(shipment.order_id) && (
                          <a
                            className="text-xs text-red-400 hover:text-red-300 hover:underline"
                            href={`https://www.ebay.com/rt/ReturnDetails?returnId=${orderToReturnId.get(shipment.order_id)}`}
                            target="_blank"
                            rel="noreferrer"
                            title="View return on eBay"
                          >
                            [View Return ↗]
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${
                          shipment.order?.order_status === 'Cancelled' ? 'bg-slate-700 text-slate-300' :
                          shipment.delivered_at ? 'bg-green-900 text-green-300' :
                          (() => {
                            const hasTracking = (shipment.tracking_numbers?.length ?? 0) > 0;
                            if (hasTracking && !shipment.delivered_at) {
                              let expectedBy: Date | null = null;
                              if (shipment.estimated_max) {
                                expectedBy = new Date(shipment.estimated_max);
                              } else if (shipment.order?.purchase_date) {
                                expectedBy = new Date(shipment.order.purchase_date);
                                expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
                              }
                              if (expectedBy && now > expectedBy) {
                                return 'bg-amber-900 text-amber-300';
                              }
                            }
                            return hasTracking ? 'bg-blue-900 text-blue-300' : 'bg-rose-900 text-rose-300';
                          })()
                        }`}>
                          {shipment.order?.order_status === 'Cancelled' ? 'Cancelled' :
                           shipment.delivered_at ? 'Delivered' :
                           (() => {
                             const hasTracking = (shipment.tracking_numbers?.length ?? 0) > 0;
                             if (hasTracking && !shipment.delivered_at) {
                               let expectedBy: Date | null = null;
                               if (shipment.estimated_max) {
                                 expectedBy = new Date(shipment.estimated_max);
                               } else if (shipment.order?.purchase_date) {
                                 expectedBy = new Date(shipment.order.purchase_date);
                                 expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
                               }
                               if (expectedBy && now > expectedBy) return 'Overdue';
                               return 'In Transit';
                             }
                             return 'Never Shipped';
                           })()}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${shipment.checked_in_at ? 'bg-emerald-900 text-emerald-300' : 'bg-yellow-900 text-yellow-300'}`}>
                          {shipment.checked_in_at ? `Checked in: ${shipment.checked_in_at.toISOString().slice(0, 10)}` : 'Not checked in'}
                        </span>
                      </div>
                    </div>

                    {/* Order items (titles) */}
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
                        >↗</a>
                      </div>
                    ))}

                    {/* Received units — condition / notes / state */}
                    {orderUnits.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                        {orderUnits.map((unit, idx) => {
                          const condColor =
                            unit.inventory_state === 'on_hand' ? 'text-emerald-400' :
                            unit.inventory_state === 'to_be_returned' ? 'text-red-400' :
                            unit.inventory_state === 'parts_repair' ? 'text-orange-400' :
                            unit.inventory_state === 'returned' ? 'text-slate-400' :
                            unit.inventory_state === 'missing' ? 'text-orange-400' :
                            'text-slate-300';
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-500">Unit {idx + 1}:</span>
                                <span className={`font-medium ${condColor}`}>{unit.condition_status}</span>
                                {unit.notes && (
                                  <span className="text-slate-400 italic">— {unit.notes}</span>
                                )}
                                <span className="ml-auto text-slate-600">
                                  {unit.received_at ? new Date(unit.received_at).toISOString().slice(0, 10) : ''}
                                </span>
                              </div>
                              {(unit as any).images?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pl-14">
                                  {(unit as any).images.map((img: { id: string; image_path: string }) => (
                                    <a key={img.id} href={`/api/uploads/${img.image_path}`} target="_blank" rel="noreferrer">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={`/api/uploads/${img.image_path}`}
                                        alt="Unit photo"
                                        className="h-12 w-12 rounded border border-slate-700 object-cover hover:opacity-80 transition-opacity"
                                      />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

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
                );
              })
            )}
          </div>
          )}
        </section>
      )}
    </div>
  );
}
