import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * GET /api/orders/search
 * Full-featured order search with filtering, sorting, and pagination.
 *
 * Query params:
 *   search      - global text search: order ID, item ID, item title, tracking number, eBay account username
 *   tracking    - barcode scan input (matches last 12 digits of any tracking number)
 *   status      - comma-separated order_status values (e.g. "Complete,Active")
 *   shipStatus  - comma-separated shipment derived_status values (e.g. "delivered,shipped")
 *   checkedIn   - "yes" | "no" | "" (filter by shipment check-in state)
 *   dateFrom    - ISO date string (purchase_date >=)
 *   dateTo      - ISO date string (purchase_date <=)
 *   accountId   - filter by ebay_account_id
 *   sortBy      - purchaseDate | total | status | items (default: purchaseDate)
 *   sortDir     - asc | desc (default: desc)
 *   limit       - max records (default: 100)
 *   offset      - pagination offset (default: 0)
 */
export async function GET(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const tracking = searchParams.get("tracking")?.trim() ?? "";
  const statusParam = searchParams.get("status") ?? "";
  const shipStatusParam = searchParams.get("shipStatus") ?? "";
  const checkedIn = searchParams.get("checkedIn") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const accountId = searchParams.get("accountId") ?? "";
  const sortBy = searchParams.get("sortBy") ?? "purchaseDate";
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const statuses = statusParam ? statusParam.split(",").filter(Boolean) : [];
  const shipStatuses = shipStatusParam ? shipStatusParam.split(",").filter(Boolean) : [];

  const where: any = {};

  // Date range
  if (dateFrom || dateTo) {
    where.purchase_date = {};
    if (dateFrom) where.purchase_date.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.purchase_date.lte = end;
    }
  }

  // eBay account filter
  if (accountId) where.ebay_account_id = accountId;

  // Order status filter
  if (statuses.length > 0) where.order_status = { in: statuses };

  // Global text search — resolves to order IDs from multiple sources
  if (search) {
    const orderIdSets: string[][] = [];

    // 1. Direct order ID match
    orderIdSets.push([search]);

    // 2. Item ID match → find order_items → get order_ids
    const itemIdMatches = await prisma.order_items.findMany({
      where: { item_id: { contains: search, mode: "insensitive" } },
      select: { order_id: true },
    });
    if (itemIdMatches.length > 0) orderIdSets.push(itemIdMatches.map(r => r.order_id));

    // 3. Item title match → find order_items → get order_ids
    const titleMatches = await prisma.order_items.findMany({
      where: { title: { contains: search, mode: "insensitive" } },
      select: { order_id: true },
    });
    if (titleMatches.length > 0) orderIdSets.push(titleMatches.map(r => r.order_id));

    // 4. Tracking number match (typed, partial)
    const trackingMatches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: { contains: search, mode: "insensitive" } },
      select: { shipment: { select: { order_id: true } } },
    });
    const trackingOrderIds = trackingMatches
      .map(t => t.shipment?.order_id)
      .filter((id): id is string => Boolean(id));
    if (trackingOrderIds.length > 0) orderIdSets.push(trackingOrderIds);

    // 5. eBay account username match → find accounts → get order_ids
    const accountMatches = await prisma.ebay_accounts.findMany({
      where: { ebay_username: { contains: search, mode: "insensitive" } },
      select: { id: true },
    });
    if (accountMatches.length > 0) {
      const accountOrderIds = await prisma.orders.findMany({
        where: { ebay_account_id: { in: accountMatches.map(a => a.id) } },
        select: { order_id: true },
      });
      orderIdSets.push(accountOrderIds.map(o => o.order_id));
    }

    // Union all matched order IDs
    const allMatchedIds = new Set<string>();
    // Direct order ID match — check if starts with search
    const directOrderMatches = await prisma.orders.findMany({
      where: { order_id: { contains: search, mode: "insensitive" } },
      select: { order_id: true },
    });
    directOrderMatches.forEach(o => allMatchedIds.add(o.order_id));
    // Add all other matches
    for (const ids of orderIdSets.slice(1)) {
      ids.forEach(id => allMatchedIds.add(id));
    }

    where.order_id = { in: Array.from(allMatchedIds) };
  }

  // Tracking barcode scan (last 12 digits)
  if (tracking) {
    const last12 = tracking.replace(/\D/g, "").slice(-12);
    const trackingMatches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: { endsWith: last12 } },
      select: { shipment: { select: { order_id: true } } },
    });
    const scanOrderIds = trackingMatches
      .map(t => t.shipment?.order_id)
      .filter((id): id is string => Boolean(id));
    // Intersect with existing where if search is also set
    if (where.order_id) {
      const existing = new Set(where.order_id.in as string[]);
      where.order_id = { in: scanOrderIds.filter(id => existing.has(id)) };
    } else {
      where.order_id = { in: scanOrderIds };
    }
  }

  // Shipment-level filters (derived_status, checked_in)
  let shipmentOrderIds: string[] | null = null;
  if (shipStatuses.length > 0 || checkedIn === "yes" || checkedIn === "no") {
    const shipWhere: any = {};
    if (shipStatuses.length > 0) shipWhere.derived_status = { in: shipStatuses };
    if (checkedIn === "yes") shipWhere.checked_in_at = { not: null };
    if (checkedIn === "no") shipWhere.checked_in_at = null;

    const matchingShipments = await prisma.shipments.findMany({
      where: shipWhere,
      select: { order_id: true },
    });
    shipmentOrderIds = matchingShipments
      .map(s => s.order_id)
      .filter((id): id is string => Boolean(id));

    if (where.order_id) {
      const existing = new Set(where.order_id.in as string[]);
      where.order_id = { in: shipmentOrderIds.filter(id => existing.has(id)) };
    } else {
      where.order_id = { in: shipmentOrderIds };
    }
  }

  // Build orderBy
  const orderByMap: Record<string, any> = {
    purchaseDate: { purchase_date: sortDir },
    total: { original_total: sortDir },
    status: { order_status: sortDir },
    items: { order_id: sortDir }, // proxy sort
  };
  const orderBy = orderByMap[sortBy] ?? { purchase_date: sortDir };

  const [orders, total] = await Promise.all([
    prisma.orders.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        order_id: true,
        purchase_date: true,
        order_status: true,
        original_total: true,
        subtotal: true,
        shipping_cost: true,
        tax_amount: true,
        totals: true,
        ship_to_city: true,
        ship_to_state: true,
        ship_to_postal: true,
        order_url: true,
        ebay_account_id: true,
        ebay_account: { select: { ebay_username: true } },
        order_items: {
          select: {
            id: true,
            item_id: true,
            title: true,
            qty: true,
            transaction_price: true,
          }
        },
        shipments: {
          select: {
            id: true,
            derived_status: true,
            delivered_at: true,
            checked_in_at: true,
            expected_units: true,
            scanned_units: true,
            scan_status: true,
            is_lot: true,
            tracking_numbers: {
              select: { tracking_number: true, carrier: true }
            }
          }
        },
        received_units: {
          select: { inventory_state: true },
        },
        returns: {
          select: {
            id: true,
            ebay_return_id: true,
            ebay_state: true,
            ebay_status: true,
            escalated: true,
            refund_amount: true,
          },
          take: 1,
          orderBy: { created_at: "desc" },
        },
        inr_cases: {
          select: {
            id: true,
            ebay_inquiry_id: true,
            ebay_status: true,
            escalated_to_case: true,
            case_id: true,
            claim_amount: true,
          },
          take: 1,
          orderBy: { created_at: "desc" },
        },
      }
    }),
    prisma.orders.count({ where }),
  ]);

  return NextResponse.json({
    orders: orders.map(o => {
      const shipment = o.shipments[0] ?? null;
      const currentTotal = o.totals && typeof o.totals === "object" && "total" in (o.totals as any)
        ? Number((o.totals as any).total)
        : null;
      const originalTotal = o.original_total ? Number(o.original_total) : null;
      const hasRefund = currentTotal != null && originalTotal != null && currentTotal < originalTotal;
      // Matches inventory page logic: needs return if any received unit has inventory_state === "to_be_returned"
      const needsReturn = o.received_units.some(u => u.inventory_state === "to_be_returned");
      return {
        orderId: o.order_id,
        purchaseDate: o.purchase_date.toISOString(),
        orderStatus: o.order_status,
        originalTotal,
        subtotal: o.subtotal ? Number(o.subtotal) : null,
        shippingCost: o.shipping_cost ? Number(o.shipping_cost) : null,
        taxAmount: o.tax_amount ? Number(o.tax_amount) : null,
        currentTotal,
        hasRefund,
        needsReturn,
        shipToCity: o.ship_to_city,
        shipToState: o.ship_to_state,
        shipToPostal: o.ship_to_postal,
        orderUrl: o.order_url,
        ebayAccountId: o.ebay_account_id,
        ebayUsername: o.ebay_account?.ebay_username ?? null,
        items: o.order_items.map(i => ({
          itemId: i.item_id,
          title: i.title,
          qty: i.qty,
          price: Number(i.transaction_price),
        })),
        shipment: shipment ? {
          derivedStatus: shipment.derived_status,
          deliveredAt: shipment.delivered_at?.toISOString() ?? null,
          checkedInAt: shipment.checked_in_at?.toISOString() ?? null,
          expectedUnits: shipment.expected_units,
          scannedUnits: shipment.scanned_units,
          scanStatus: shipment.scan_status,
          isLot: shipment.is_lot,
          trackingNumbers: shipment.tracking_numbers.map(t => ({
            number: t.tracking_number,
            carrier: t.carrier,
          })),
        } : null,
        returnCase: (() => {
          const r = o.returns[0];
          if (!r) return null;
          return {
            id: r.id,
            ebayReturnId: r.ebay_return_id,
            state: r.ebay_state,
            status: r.ebay_status,
            escalated: r.escalated,
            refundAmount: r.refund_amount ? Number(r.refund_amount) : null,
            url: `https://www.ebay.com/rt/ReturnDetails?returnId=${r.ebay_return_id}`,
          };
        })(),
        inrCase: (() => {
          const c = o.inr_cases[0];
          if (!c) return null;
          const linkId = c.escalated_to_case && c.case_id ? c.case_id : c.ebay_inquiry_id;
          return {
            id: c.id,
            ebayInquiryId: c.ebay_inquiry_id,
            status: c.ebay_status,
            escalatedToCase: c.escalated_to_case,
            caseId: c.case_id,
            claimAmount: c.claim_amount ? Number(c.claim_amount) : null,
            url: `https://www.ebay.com/ItemNotReceived/${linkId}`,
          };
        })(),
      };
    }),
    total,
    limit,
    offset,
  });
}
