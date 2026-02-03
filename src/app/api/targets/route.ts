import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { z } from "zod";
import { queues } from "@/lib/queue";

const targetSchema = z.object({
  item_id: z.string().min(3),
  type: z.enum(["AUCTION", "BIN", "BEST_OFFER"]),
  max_snipe_bid: z.string().optional(),
  best_offer_amount: z.string().optional(),
  lead_seconds: z.number().min(3).max(10),
  notes: z.string().optional()
});

export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER", "VIEWER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const targets = await prisma.targets.findMany({
    include: { listing: true },
    orderBy: { created_at: "desc" }
  });
  return NextResponse.json({ targets });
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const json = await req.json();
  const data = targetSchema.safeParse(json);
  if (!data.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const target = await prisma.targets.create({
    data: {
      item_id: data.data.item_id,
      type: data.data.type,
      max_snipe_bid: data.data.max_snipe_bid ? Number(data.data.max_snipe_bid) : null,
      best_offer_amount: data.data.best_offer_amount ? Number(data.data.best_offer_amount) : null,
      lead_seconds: data.data.lead_seconds,
      created_by: auth.session.user.id,
      status: "TARGETED",
      status_history: [{ status: "TARGETED", at: new Date().toISOString() }],
      notes: data.data.notes ?? null
    }
  });

  await queues.enrichListing.add("enrich", { itemId: target.item_id });

  return NextResponse.json({ target }, { status: 201 });
}
