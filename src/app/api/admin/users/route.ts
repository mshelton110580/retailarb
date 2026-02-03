import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "RECEIVER", "VIEWER"])
});

export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const users = await prisma.users.findMany({
    select: { id: true, email: true, role: true, created_at: true }
  });
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = createSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const password_hash = await bcrypt.hash(body.data.password, 12);
  const user = await prisma.users.create({
    data: {
      email: body.data.email,
      password_hash,
      role: body.data.role
    },
    select: { id: true, email: true, role: true, created_at: true }
  });
  return NextResponse.json({ user });
}
