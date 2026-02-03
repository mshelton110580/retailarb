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
  const updated = await prisma.returns.update({
    where: { id: body.data.returnId },
    data: {
      filed_manually_at: new Date(),
      scrape_state: "ACTIVE",
      next_scrape_at: new Date()
    }
  });
  await queues.returnsScrape.add("scrape", { returnId: updated.id });
  return NextResponse.json({ return: updated });
}
