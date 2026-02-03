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
  const ret = await prisma.returns.create({
    data: {
      order_id: body.data.order_id,
      item_id: body.data.item_id ?? null,
      notes: body.data.notes ?? null,
      scrape_state: "PENDING",
      scrape_attempts: 0
    }
  });
  return NextResponse.json({ return: ret }, { status: 201 });
}
