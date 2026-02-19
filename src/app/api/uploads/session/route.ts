import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  receivedUnitId: z.string().min(1),
});

// POST /api/uploads/session
// Creates an upload session for a received unit, returns sessionId for QR code
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // Verify the unit exists
  const unit = await prisma.received_units.findUnique({
    where: { id: body.data.receivedUnitId },
    select: {
      id: true,
      unit_index: true,
      condition_status: true,
      order_id: true,
      listing: { select: { title: true } },
      order_item: { select: { title: true } },
    },
  });
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const session = await prisma.upload_sessions.create({
    data: {
      received_unit_id: body.data.receivedUnitId,
      expires_at: expiresAt,
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    expiresAt: session.expires_at,
    unit: {
      id: unit.id,
      unitIndex: unit.unit_index,
      title: unit.listing?.title ?? unit.order_item?.title ?? "Unknown",
      condition: unit.condition_status,
      orderId: unit.order_id,
    },
  });
}
