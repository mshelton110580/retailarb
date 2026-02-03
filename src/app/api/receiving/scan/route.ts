import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  tracking: z.string().min(8),
  condition_status: z.string(),
  order_id: z.string().optional(),
  item_id: z.string().optional(),
  notes: z.string().optional()
});

function last8(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-8);
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const tracking_last8 = last8(body.data.tracking);

  const matches = await prisma.tracking_numbers.findMany({
    where: { tracking_number: { endsWith: tracking_last8 } },
    include: { shipment: { include: { order: { include: { order_items: true } } } } }
  });

  const scan = await prisma.receiving_scans.create({
    data: {
      tracking_last8,
      scanned_by_user_id: auth.session.user.id,
      resolution_state: matches.length ? "MATCHED" : "UNRESOLVED",
      notes: body.data.notes ?? null
    }
  });

  return NextResponse.json({ scan, matches });
}
