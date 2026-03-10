import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { findTrackingOrderIds } from "@/lib/tracking-search";
import { parseFieldSearch } from "@/lib/search-parser";

/**
 * GET /api/orders/search
 * Full-featured order search with filtering, sorting, and pagination.
 *
 * Query params:
 *   search      - global text search or field:value (order, item, title, tracking, account)
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
  const chipsParam = searchParams.get("chips") ?? "";
  const statusParam = searchParams.get("status") ?? "";
  const shipStatusParam = searchParams.get("shipStatus") ?? "";
  const checkedIn = searchParams.get("checkedIn") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const accountId = searchParams.get("accountId") ?? "";
  const sortBy = searchParams.get("sortBy") ?? "purchaseDate";
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "250"), 2000);
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

  // --- Helper: resolve a single field search to a set of order IDs ---
  async function resolveFieldToOrderIds(field: string, value: string): Promise<Set<string>> {
    const ids = new Set<string>();
    if (field === "order") {
      const matches = await prisma.orders.findMany({
        where: { order_id: { contains: value, mode: "insensitive" } },
        select: { order_id: true },
      });
      matches.forEach(o => ids.add(o.order_id));
    } else if (field === "item") {
      const matches = await prisma.order_items.findMany({
        where: { item_id: { contains: value, mode: "insensitive" } },
        select: { order_id: true },
      });
      matches.forEach(r => ids.add(r.order_id));
    } else if (field === "title") {
      const matches = await prisma.order_items.findMany({
        where: { title: { contains: value, mode: "insensitive" } },
        select: { order_id: true },
      });
      matches.forEach(r => ids.add(r.order_id));
    } else if (field === "tracking") {
      const trackingOrderIds = await findTrackingOrderIds(value);
      trackingOrderIds.forEach(id => ids.add(id));
    } else if (field === "account") {
      const accountMatches = await prisma.ebay_accounts.findMany({
        where: { ebay_username: { contains: value, mode: "insensitive" } },
        select: { id: true },
      });
      if (accountMatches.length > 0) {
        const accountOrderIds = await prisma.orders.findMany({
          where: { ebay_account_id: { in: accountMatches.map(a => a.id) } },
          select: { order_id: true },
        });
        accountOrderIds.forEach(o => ids.add(o.order_id));
      }
    }
    return ids;
  }

  // --- Helper: resolve global search to a set of order IDs (union across all fields) ---
  async function resolveGlobalToOrderIds(value: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const [directMatches, itemIdMatches, titleMatches, trackingOrderIds, accountMatches] = await Promise.all([
      prisma.orders.findMany({ where: { order_id: { contains: value, mode: "insensitive" } }, select: { order_id: true } }),
      prisma.order_items.findMany({ where: { item_id: { contains: value, mode: "insensitive" } }, select: { order_id: true } }),
      prisma.order_items.findMany({ where: { title: { contains: value, mode: "insensitive" } }, select: { order_id: true } }),
      findTrackingOrderIds(value),
      prisma.ebay_accounts.findMany({ where: { ebay_username: { contains: value, mode: "insensitive" } }, select: { id: true } }),
    ]);
    directMatches.forEach(o => ids.add(o.order_id));
    itemIdMatches.forEach(r => ids.add(r.order_id));
    titleMatches.forEach(r => ids.add(r.order_id));
    trackingOrderIds.forEach(id => ids.add(id));
    if (accountMatches.length > 0) {
      const accountOrderIds = await prisma.orders.findMany({
        where: { ebay_account_id: { in: accountMatches.map(a => a.id) } },
        select: { order_id: true },
      });
      accountOrderIds.forEach(o => ids.add(o.order_id));
    }
    return ids;
  }

  // Collect order ID sets from chips (each chip narrows results — AND)
  type SearchChip = { field: string; value: string };
  let chips: SearchChip[] = [];
  if (chipsParam) {
    try { chips = JSON.parse(chipsParam); } catch {}
  }

  const chipIdSets: Set<string>[] = [];
  for (const chip of chips) {
    if (!chip.field || !chip.value?.trim()) continue;
    chipIdSets.push(await resolveFieldToOrderIds(chip.field, chip.value.trim()));
  }

  // Handle free-text search param (legacy field:value syntax or global)
  const ORDER_SEARCH_FIELDS = ["order", "item", "title", "tracking", "account"];
  if (search) {
    const { field, value } = parseFieldSearch(search, ORDER_SEARCH_FIELDS);
    if (value) {
      chipIdSets.push(field
        ? await resolveFieldToOrderIds(field, value)
        : await resolveGlobalToOrderIds(value)
      );
    } else if (field) {
      chipIdSets.push(new Set()); // field: with no value → no matches
    }
  }

  // Intersect all sets (AND logic across chips + free text)
  if (chipIdSets.length > 0) {
    let result = chipIdSets[0];
    for (let i = 1; i < chipIdSets.length; i++) {
      result = new Set([...result].filter(id => chipIdSets[i].has(id)));
    }
    where.order_id = { in: Array.from(result) };
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
            order_line_item_id: true,
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
          select: { inventory_state: true, order_item_id: true },
        },
        returns: {
          select: {
            id: true,
            ebay_return_id: true,
            ebay_state: true,
            ebay_status: true,
            escalated: true,
            refund_amount: true,
            actual_refund: true,
            ebay_item_id: true,
          },
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
            ebay_item_id: true,
          },
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
      const orderRefund = hasRefund ? Math.round((originalTotal! - currentTotal!) * 100) / 100 : 0;
      // Matches inventory page logic: needs return if any received unit has inventory_state === "to_be_returned"
      const needsReturn = o.received_units.some(u => u.inventory_state === "to_be_returned");

      // ── Per-item refund calculation ────────────────────────────────
      const distinctItems = new Set(o.order_items.map(i => i.item_id)).size;
      const itemRefunds = new Map<string, { refund: number; needsAudit: boolean; method: string }>();

      if (orderRefund > 0) {
        if (distinctItems === 1) {
          // Single-item order: entire order refund belongs to this item
          for (const i of o.order_items) {
            itemRefunds.set(i.id, { refund: orderRefund, needsAudit: false, method: "single_item" });
          }
        } else {
          // Multi-item: use return/INR actual_refund matched by ebay_item_id
          const returnByItem = new Map<string, number>();
          for (const r of o.returns) {
            if (r.ebay_item_id && r.actual_refund != null) {
              returnByItem.set(r.ebay_item_id, (returnByItem.get(r.ebay_item_id) ?? 0) + Number(r.actual_refund));
            }
          }
          const inrByItem = new Map<string, number>();
          for (const c of o.inr_cases) {
            if (c.ebay_item_id && c.claim_amount != null) {
              inrByItem.set(c.ebay_item_id, (inrByItem.get(c.ebay_item_id) ?? 0) + Number(c.claim_amount));
            }
          }

          const knownTotal = [...returnByItem.values()].reduce((s, v) => s + v, 0)
            + [...inrByItem.values()].reduce((s, v) => s + v, 0);
          const remainder = Math.round((orderRefund - knownTotal) * 100) / 100;
          const fullyAccounted = Math.abs(remainder) < 0.02;

          // Items without return/INR data — for proportional fallback
          const unmatchedItems = o.order_items.filter(
            i => !returnByItem.has(i.item_id) && !inrByItem.has(i.item_id)
          );
          const unmatchedSubtotal = unmatchedItems.reduce(
            (s, i) => s + Number(i.transaction_price) * i.qty, 0
          );

          for (const i of o.order_items) {
            const returnRefund = returnByItem.get(i.item_id);
            const inrRefund = inrByItem.get(i.item_id);

            if (returnRefund != null || inrRefund != null) {
              // Exact from return/INR
              itemRefunds.set(i.id, {
                refund: Math.round(((returnRefund ?? 0) + (inrRefund ?? 0)) * 100) / 100,
                needsAudit: false,
                method: returnRefund != null ? "return" : "inr",
              });
            } else if (fullyAccounted) {
              // Return/INR covers full order refund — this item has no refund
              itemRefunds.set(i.id, { refund: 0, needsAudit: false, method: "no_refund" });
            } else if (remainder > 0 && unmatchedSubtotal > 0) {
              // Remainder not covered by return/INR — needs audit
              const itemSub = Number(i.transaction_price) * i.qty;
              const proportional = Math.round((remainder * itemSub / unmatchedSubtotal) * 100) / 100;
              itemRefunds.set(i.id, { refund: proportional, needsAudit: true, method: "proportional" });
            } else {
              itemRefunds.set(i.id, { refund: 0, needsAudit: remainder > 0.01, method: "unknown" });
            }
          }
        }
      }

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
        orderRefund: orderRefund > 0 ? orderRefund : null,
        needsReturn,
        shipToCity: o.ship_to_city,
        shipToState: o.ship_to_state,
        shipToPostal: o.ship_to_postal,
        orderUrl: o.order_url,
        ebayAccountId: o.ebay_account_id,
        ebayUsername: o.ebay_account?.ebay_username ?? null,
        items: o.order_items.map(i => {
          const ir = itemRefunds.get(i.id);
          return {
            itemId: i.item_id,
            title: i.title,
            qty: i.qty,
            price: Number(i.transaction_price),
            refund: ir?.refund ?? null,
            refundMethod: ir?.method ?? null,
            needsAudit: ir?.needsAudit ?? false,
          };
        }),
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
        // Escalated if ANY return or INR is escalated
        hasEscalatedReturn: o.returns.some(r => r.escalated),
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
