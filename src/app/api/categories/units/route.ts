import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * GET /api/categories/units?categoryId=xxx
 * Returns units for a given category with title and order info
 */
export async function GET(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

  if (!categoryId) {
    return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  }

  const units = await prisma.received_units.findMany({
    where: { category_id: categoryId },
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
