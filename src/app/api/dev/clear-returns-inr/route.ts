import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * POST /api/dev/clear-returns-inr
 * Deletes all order-related data in FK-safe order:
 *
 *   Tier 1 (no dependents): unit_images, tracking_numbers
 *   Tier 2: received_units, shipments, receiving_scans
 *   Tier 3: order_items, returns, inr_cases
 *   Tier 4: orders
 *
 * Does NOT touch targets, listings, ebay_accounts, or users.
 * ADMIN only. Safe to run before a fresh reimport.
 */
export async function POST() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Tier 0: FK-dependent on received_units
  await prisma.upload_sessions.deleteMany({});
  await prisma.lot_units.deleteMany({});

  // Tier 1: leaf tables
  const [unitImages, trackingNums] = await Promise.all([
    prisma.unit_images.deleteMany({}),
    prisma.tracking_numbers.deleteMany({}),
  ]);

  // Tier 2: depend on tier 1
  const [receivedUnits, shipments, receivingScans] = await Promise.all([
    prisma.received_units.deleteMany({}),
    prisma.shipments.deleteMany({}),
    prisma.receiving_scans.deleteMany({}),
  ]);

  // Tier 3: depend on orders (or order_items)
  const [orderItems, returns_, inrCases] = await Promise.all([
    prisma.order_items.deleteMany({}),
    prisma.returns.deleteMany({}),
    prisma.inr_cases.deleteMany({}),
  ]);

  // Tier 4: orders
  const orders = await prisma.orders.deleteMany({});

  return NextResponse.json({
    ok: true,
    deleted: {
      orders: orders.count,
      order_items: orderItems.count,
      shipments: shipments.count,
      tracking_numbers: trackingNums.count,
      receiving_scans: receivingScans.count,
      received_units: receivedUnits.count,
      unit_images: unitImages.count,
      returns: returns_.count,
      inr_cases: inrCases.count,
    },
  });
}

/**
 * GET /api/dev/clear-returns-inr
 * Returns current record counts without deleting anything.
 */
export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [orders, orderItems, shipments, receivedUnits, returns_, inrCases] = await Promise.all([
    prisma.orders.count(),
    prisma.order_items.count(),
    prisma.shipments.count(),
    prisma.received_units.count(),
    prisma.returns.count(),
    prisma.inr_cases.count(),
  ]);

  return NextResponse.json({
    orders,
    order_items: orderItems,
    shipments,
    received_units: receivedUnits,
    returns: returns_,
    inr_cases: inrCases,
  });
}
