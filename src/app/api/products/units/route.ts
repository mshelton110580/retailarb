import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * GET /api/products/units?productId=xxx
 * Returns units for a given product with title and order info
 */
export async function GET(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const units = await prisma.received_units.findMany({
    where: { product_id: productId },
    select: {
      id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true,
      received_at: true,
      order_id: true,
      listing: { select: { title: true } },
      order_item: { select: { title: true } }
    },
    orderBy: { received_at: "desc" }
  });

  return NextResponse.json(
    units.map(u => ({
      id: u.id,
      orderId: u.order_id,
      unitIndex: u.unit_index,
      title: u.listing?.title ?? u.order_item?.title ?? "Unknown",
      condition: u.condition_status,
      state: u.inventory_state,
      receivedAt: u.received_at.toISOString()
    }))
  );
}
