import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  order_id: z.string(),
  item_id: z.string().optional(),
  notes: z.string().optional()
});

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Prevent duplicate: check if this order already has an INR case
  const existing = await prisma.inr_cases.findFirst({
    where: { order_id: body.data.order_id },
  });
  if (existing) {
    return NextResponse.json(
      { error: "INR case already exists for this order", existing: existing.id },
      { status: 409 }
    );
  }

  const inrCase = await prisma.inr_cases.create({
    data: {
      order_id: body.data.order_id,
      item_id: body.data.item_id ?? null,
      filed_manually_at: new Date(),
      status_text: "INR filed",
      notes: body.data.notes ?? null
    }
  });
  return NextResponse.json({ inrCase }, { status: 201 });
}
