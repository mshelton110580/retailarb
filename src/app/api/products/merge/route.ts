import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  fromProductName: z.string(),
  toProductId: z.string()
});

/**
 * POST /api/products/merge - Create a product alias mapping
 * When a new product name should map to an existing product
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Verify target product exists
    const targetProduct = await prisma.products.findUnique({
      where: { id: body.data.toProductId }
    });

    if (!targetProduct) {
      return NextResponse.json({ error: "Target product not found" }, { status: 404 });
    }

    // Create or update merge mapping
    const merge = await prisma.$queryRawUnsafe(
      `INSERT INTO product_aliases (id, from_product_name, to_product_id, created_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       ON CONFLICT (from_product_name)
       DO UPDATE SET to_product_id = $2, created_by = $3
       RETURNING id`,
      body.data.fromProductName,
      body.data.toProductId,
      auth.session.user.id
    );

    return NextResponse.json({
      ok: true,
      merge,
      message: `"${body.data.fromProductName}" will now be merged into "${targetProduct.product_name}"`
    });

  } catch (error: any) {
    console.error("Failed to create product merge:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create merge" },
      { status: 500 }
    );
  }
}
