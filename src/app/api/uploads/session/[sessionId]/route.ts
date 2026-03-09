import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/uploads/session/[sessionId]
// Returns session info + uploaded images — used for polling on workstation
export async function GET(
  req: Request,
  { params }: { params: { sessionId: string } }
) {
  const session = await prisma.upload_sessions.findUnique({
    where: { id: params.sessionId },
    include: {
      unit: {
        select: {
          id: true,
          unit_index: true,
          condition_status: true,
          order_id: true,
          listing: { select: { title: true } },
          order_item: { select: { title: true } },
        },
      },
      images: {
        orderBy: { created_at: "asc" },
        select: { id: true, created_at: true },
      },
    },
  });

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.expires_at < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  return NextResponse.json({
    sessionId: session.id,
    expiresAt: session.expires_at,
    unit: {
      id: session.unit.id,
      unitIndex: session.unit.unit_index,
      title: session.unit.listing?.title ?? session.unit.order_item?.title ?? "Unknown",
      condition: session.unit.condition_status,
      orderId: session.unit.order_id,
    },
    images: session.images.map((img) => ({
      id: img.id,
      url: `/api/images/${img.id}`,
      createdAt: img.created_at,
    })),
  });
}
