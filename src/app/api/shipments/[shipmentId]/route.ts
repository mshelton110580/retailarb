import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["mark_delivered"]),
  delivered_at: z.string().optional(), // ISO date string; defaults to now
});

/**
 * PATCH /api/shipments/[shipmentId]
 * Manually update a shipment's status. Currently supports:
 * - mark_delivered: sets delivered_at and derived_status="delivered"
 *   Used when a seller provides tracking via INR/case response and eBay's
 *   order API doesn't reflect the actual delivery.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { shipmentId: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const shipment = await prisma.shipments.findUnique({
    where: { id: params.shipmentId },
  });
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  if (body.data.action === "mark_delivered") {
    const deliveredAt = body.data.delivered_at
      ? new Date(body.data.delivered_at)
      : new Date();

    await prisma.shipments.update({
      where: { id: params.shipmentId },
      data: {
        delivered_at: deliveredAt,
        derived_status: "delivered",
        last_refreshed_at: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      shipmentId: params.shipmentId,
      deliveredAt: deliveredAt.toISOString(),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
