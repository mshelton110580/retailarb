import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateSchema = z.object({
  password: z.string().min(8).optional(),
  role: z.enum(["ADMIN", "RECEIVER", "VIEWER"]).optional(),
}).refine(d => d.password || d.role, { message: "Nothing to update" });

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { userId } = await params;
  const body = updateSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });

  const data: Record<string, string> = {};
  if (body.data.password) data.password_hash = await bcrypt.hash(body.data.password, 12);
  if (body.data.role) data.role = body.data.role;

  const user = await prisma.users.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, role: true },
  });
  return NextResponse.json({ user });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { userId } = await params;

  // Prevent deleting yourself
  if (auth.session?.user?.id === userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await prisma.users.delete({ where: { id: userId } });
  return NextResponse.json({ ok: true });
}
