import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/products/merge/[id] - Delete a product alias mapping
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM product_aliases WHERE id = $1`,
      params.id
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Failed to delete merge mapping:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to delete merge mapping" },
      { status: 500 }
    );
  }
}
