import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { findTrackingOrderIds } from "@/lib/tracking-search";
import { parseFieldSearch } from "@/lib/search-parser";

type SearchChip = { field: string; value: string };

/**
 * Build a Prisma WHERE fragment for a single field:value search on received_units.
 * Returns conditions to AND into the main where clause.
 */
async function buildFieldCondition(field: string, value: string): Promise<any | null> {
  switch (field) {
    case "title": {
      const [listingMatches, orderItemMatches] = await Promise.all([
        prisma.listings.findMany({
          where: { title: { contains: value, mode: "insensitive" } },
          select: { item_id: true }
        }),
        prisma.order_items.findMany({
          where: { title: { contains: value, mode: "insensitive" } },
          select: { order_id: true }
        }),
      ]);
      const or: any[] = [];
      if (listingMatches.length > 0) or.push({ item_id: { in: listingMatches.map(l => l.item_id) } });
      if (orderItemMatches.length > 0) or.push({ order_id: { in: orderItemMatches.map(o => o.order_id) } });
      return or.length > 0 ? { OR: or } : { id: "__no_match__" };
    }
    case "order":
      return { order_id: { contains: value, mode: "insensitive" } };
    case "item":
      return { item_id: { contains: value, mode: "insensitive" } };
    case "condition":
      return { condition_status: { contains: value, mode: "insensitive" } };
    case "notes":
      return { notes: { contains: value, mode: "insensitive" } };
    case "tracking": {
      const trackingOrderIds = await findTrackingOrderIds(value);
      return trackingOrderIds.length > 0
        ? { order_id: { in: trackingOrderIds } }
        : { id: "__no_match__" };
    }
    case "product": {
      const productMatches = await prisma.products.findMany({
        where: { product_name: { contains: value, mode: "insensitive" } },
        select: { id: true }
      });
      return productMatches.length > 0
        ? { product_id: { in: productMatches.map(p => p.id) } }
        : { id: "__no_match__" };
    }
    default:
      return null;
  }
}

/**
 * Build a global (all-fields) search condition.
 */
async function buildGlobalCondition(value: string): Promise<any> {
  const [listingMatches, orderItemMatches, trackingOrderIds, productMatches] = await Promise.all([
    prisma.listings.findMany({
      where: { title: { contains: value, mode: "insensitive" } },
      select: { item_id: true }
    }),
    prisma.order_items.findMany({
      where: { title: { contains: value, mode: "insensitive" } },
      select: { order_id: true }
    }),
    findTrackingOrderIds(value),
    prisma.products.findMany({
      where: { product_name: { contains: value, mode: "insensitive" } },
      select: { id: true }
    }),
  ]);

  const searchOr: any[] = [
    { order_id: { contains: value, mode: "insensitive" } },
    { item_id: { contains: value, mode: "insensitive" } },
    { condition_status: { contains: value, mode: "insensitive" } },
    { notes: { contains: value, mode: "insensitive" } },
  ];
  if (listingMatches.length > 0) {
    searchOr.push({ item_id: { in: listingMatches.map(l => l.item_id) } });
  }
  if (orderItemMatches.length > 0) {
    searchOr.push({ order_id: { in: orderItemMatches.map(o => o.order_id) } });
  }
  if (trackingOrderIds.length > 0) {
    searchOr.push({ order_id: { in: trackingOrderIds } });
  }
  if (productMatches.length > 0) {
    searchOr.push({ product_id: { in: productMatches.map(p => p.id) } });
  }

  return { OR: searchOr };
}

/**
 * GET /api/units
 * Returns received units with filtering, search, and sorting.
 *
 * Query params:
 *   search        - free-text search (all fields) or legacy field:value syntax
 *   chips         - JSON array of {field, value} for field-specific searches (AND combined)
 *   productId     - filter by product ID ("none" for uncategorized)
 *   state         - filter by inventory_state (comma-separated for multiple)
 *   condition     - filter by condition_status (comma-separated)
 *   sortBy        - field to sort by: receivedAt|title|condition|state|product (default: receivedAt)
 *   sortDir       - asc|desc (default: desc)
 *   limit         - max records (default: 500)
 *   offset        - pagination offset (default: 0)
 */
export async function GET(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const chipsParam = searchParams.get("chips") ?? "";
  const productId = searchParams.get("productId") ?? searchParams.get("categoryId") ?? "";
  const stateParam = searchParams.get("state") ?? "";
  const conditionParam = searchParams.get("condition") ?? "";
  const sortBy = searchParams.get("sortBy") ?? "receivedAt";
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500"), 1000);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const states = stateParam ? stateParam.split(",").filter(Boolean) : [];
  const conditions = conditionParam ? conditionParam.split(",").filter(Boolean) : [];

  // Build where clause
  const where: any = {};

  if (states.length > 0) {
    where.inventory_state = { in: states };
  }
  if (conditions.length > 0) {
    where.condition_status = { in: conditions };
  }
  if (productId === "none") {
    where.product_id = null;
  } else if (productId) {
    where.product_id = productId;
  }

  // Collect all AND conditions from chips and free-text search
  const andConditions: any[] = [];

  // Parse structured chips param
  let chips: SearchChip[] = [];
  if (chipsParam) {
    try { chips = JSON.parse(chipsParam); } catch {}
  }

  // Build field-specific conditions from chips (AND combined)
  for (const chip of chips) {
    if (!chip.field || !chip.value?.trim()) continue;
    const cond = await buildFieldCondition(chip.field, chip.value.trim());
    if (cond) andConditions.push(cond);
  }

  // Handle free-text search param
  const UNIT_SEARCH_FIELDS = ["title", "order", "item", "condition", "notes", "tracking", "product"];
  if (search) {
    const { field, value } = parseFieldSearch(search, UNIT_SEARCH_FIELDS);
    if (value) {
      if (field) {
        const cond = await buildFieldCondition(field, value);
        if (cond) andConditions.push(cond);
      } else {
        andConditions.push(await buildGlobalCondition(value));
      }
    } else if (field) {
      // field: with empty value
      andConditions.push({ id: "__no_match__" });
    }
  }

  // Apply all search conditions
  if (andConditions.length === 1) {
    Object.assign(where, andConditions[0]);
  } else if (andConditions.length > 1) {
    where.AND = [...(where.AND ?? []), ...andConditions];
  }

  // Build orderBy
  const orderByMap: Record<string, any> = {
    receivedAt: { received_at: sortDir },
    condition: { condition_status: sortDir },
    state: { inventory_state: sortDir },
    product: { product: { product_name: sortDir } },
    category: { product: { product_name: sortDir } }, // backward compat sort key
    title: { listing: { title: sortDir } },
  };
  const orderBy = orderByMap[sortBy] ?? { received_at: sortDir };

  const [units, total] = await Promise.all([
    prisma.received_units.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        order_id: true,
        item_id: true,
        unit_index: true,
        condition_status: true,
        inventory_state: true,
        received_at: true,
        notes: true,
        product: { select: { id: true, product_name: true } },
        listing: { select: { title: true } },
        order_item: { select: { title: true } },
        images: { select: { id: true } },
        order: {
          select: {
            order_id: true,
            shipments: {
              select: {
                tracking_numbers: { select: { tracking_number: true } }
              }
            }
          }
        }
      }
    }),
    prisma.received_units.count({ where })
  ]);

  return NextResponse.json({
    units: units.map(u => ({
      id: u.id,
      orderId: u.order_id,
      itemId: u.item_id,
      unitIndex: u.unit_index,
      condition: u.condition_status,
      state: u.inventory_state,
      receivedAt: u.received_at.toISOString(),
      notes: u.notes,
      product: u.product ? { id: u.product.id, name: u.product.product_name } : null,
      title: u.listing?.title ?? u.order_item?.title ?? "Unknown",
      trackingNumbers: u.order?.shipments?.flatMap(s =>
        s.tracking_numbers.map(t => t.tracking_number)
      ) ?? [],
      images: u.images.map(i => ({ id: i.id, url: `/api/images/${i.id}` }))
    })),
    total,
    limit,
    offset
  });
}
