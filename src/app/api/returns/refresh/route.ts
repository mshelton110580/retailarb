import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { queues } from "@/lib/queue";
import { z } from "zod";

const schema = z.object({
  returnId: z.string()
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
  const record = await prisma.returns.findUnique({ where: { id: body.data.returnId } });
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (record.last_scraped_at && Date.now() - record.last_scraped_at.getTime() < 5 * 60 * 1000) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  await queues.returnsScrape.add("scrape", { returnId: record.id });
  return NextResponse.json({ ok: true });
}
