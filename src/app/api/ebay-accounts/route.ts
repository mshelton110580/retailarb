import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";

const schema = z.object({
  ebay_username: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scopes: z.string()
});

export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER", "VIEWER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const accounts = await prisma.ebay_accounts.findMany({
    select: { id: true, ebay_username: true, last_sync_at: true, created_at: true }
  });
  return NextResponse.json({ accounts });
}

export async function DELETE(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 });
  }

  // orders.ebay_account_id is non-nullable, so we can't delete the account while orders reference it.
  // If orders exist, clear the tokens to effectively disconnect (revoke access) without deleting the record.
  const orderCount = await prisma.orders.count({ where: { ebay_account_id: id } });
  await prisma.targets.updateMany({ where: { ebay_account_id: id }, data: { ebay_account_id: null } });
  if (orderCount > 0) {
    await prisma.ebay_accounts.update({
      where: { id },
      data: { token_encrypted: "", refresh_token_encrypted: "", token_expiry: new Date(0) }
    });
  } else {
    await prisma.ebay_accounts.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const token_expiry = new Date(Date.now() + body.data.expires_in * 1000);
  const account = await prisma.ebay_accounts.create({
    data: {
      owner_user_id: auth.session.user.id,
      ebay_username: body.data.ebay_username,
      token_encrypted: encrypt(body.data.access_token),
      refresh_token_encrypted: encrypt(body.data.refresh_token),
      token_expiry,
      scopes: body.data.scopes
    }
  });
  return NextResponse.json({ account });
}
