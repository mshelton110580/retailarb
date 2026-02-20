import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * GET /api/units
 * Returns received units with filtering, search, and sorting.
 *
 * Query params:
 *   search        - text search against title, order_id, condition_status, notes
 *   tracking      - filter by tracking number last-12 digits
 *   categoryId    - filter by category ID ("none" for uncategorized)
 *   state         - filter by inventory_state (comma-separated for multiple)
 *   condition     - filter by condition_status (comma-separated)
 *   sortBy        - field to sort by: receivedAt|title|condition|state|category (default: receivedAt)
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
  const tracking = searchParams.get("tracking") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
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
  if (categoryId === "none") {
    where.category_id = null;
  } else if (categoryId) {
    where.category_id = categoryId;
  }

  // Tracking filter — match against tracking_numbers table
  let orderIdsFromTracking: string[] | null = null;
  if (tracking) {
    const last12 = tracking.replace(/\D/g, "").slice(-12);
    const matches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: { endsWith: last12 } },
      select: { shipment: { select: { order_id: true } } }
    });
    orderIdsFromTracking = matches
      .map(m => m.shipment?.order_id)
      .filter((id): id is string => Boolean(id));
    where.order_id = { in: orderIdsFromTracking };
  }

  // Text search across title (listing + order_item), order_id, condition, notes
  let searchOrderIds: string[] | null = null;
  if (search) {
    const lower = search.toLowerCase();
    // Search listings titles
    const listingMatches = await prisma.listings.findMany({
      where: { title: { contains: search, mode: "insensitive" } },
      select: { item_id: true }
    });
    const itemIds = listingMatches.map(l => l.item_id);

    const searchOr: any[] = [
      { order_id: { contains: search, mode: "insensitive" } },
      { condition_status: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
    ];
    if (itemIds.length > 0) {
      searchOr.push({ item_id: { in: itemIds } });
    }
    // Also search order_item titles directly
    const orderItemMatches = await prisma.order_items.findMany({
      where: { title: { contains: search, mode: "insensitive" } },
      select: { order_id: true }
    });
    if (orderItemMatches.length > 0) {
      searchOr.push({ order_id: { in: orderItemMatches.map(o => o.order_id) } });
    }

    where.OR = searchOr;
  }

  // Build orderBy
  const orderByMap: Record<string, any> = {
    receivedAt: { received_at: sortDir },
    condition: { condition_status: sortDir },
    state: { inventory_state: sortDir },
    category: { category: { category_name: sortDir } },
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
        category: { select: { id: true, category_name: true } },
        listing: { select: { title: true } },
        order_item: { select: { title: true } },
        images: { select: { id: true, image_path: true } },
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
      category: u.category ? { id: u.category.id, name: u.category.category_name } : null,
      title: u.listing?.title ?? u.order_item?.title ?? "Unknown",
      trackingNumbers: u.order?.shipments?.flatMap(s =>
        s.tracking_numbers.map(t => t.tracking_number)
      ) ?? [],
      images: u.images.map(i => ({ id: i.id, url: `/api/uploads/${i.image_path}` }))
    })),
    total,
    limit,
    offset
  });
}
