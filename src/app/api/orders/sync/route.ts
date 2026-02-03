import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { queues } from "@/lib/queue";
import { z } from "zod";

const schema = z.object({
  ebayAccountId: z.string().optional(),
  orderId: z.string().optional()
});

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const body = schema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  await queues.syncOrders.add("sync", body.data);
  return NextResponse.json({ ok: true });
}
