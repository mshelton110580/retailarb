import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { onProductDeleted } from "@/lib/ai";

const schema = z.object({
  fromProductId: z.string(),
  toProductId: z.string()
});

/**
 * POST /api/admin/products/merge - Merge two existing products
 * Transfers all units from source product to target product, then deletes source
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { fromProductId, toProductId } = body.data;

  if (fromProductId === toProductId) {
    return NextResponse.json({ error: "Source and target products must be different" }, { status: 400 });
  }

  try {
    // Verify both products exist
    const [fromProduct, toProduct] = await Promise.all([
      prisma.products.findUnique({ where: { id: fromProductId } }),
      prisma.products.findUnique({ where: { id: toProductId } })
    ]);

    if (!fromProduct) {
      return NextResponse.json({ error: "Source product not found" }, { status: 404 });
    }

    if (!toProduct) {
      return NextResponse.json({ error: "Target product not found" }, { status: 404 });
    }

    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Transfer all units from source to target product
      const updateResult = await tx.received_units.updateMany({
        where: { product_id: fromProductId },
        data: { product_id: toProductId }
      });

      // IMPORTANT: Create an alias mapping to preserve the alias
      // This ensures if "fromProductName" is detected again, it auto-merges to target
      await tx.$executeRawUnsafe(
        `INSERT INTO product_aliases (id, from_product_name, to_product_id, created_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT (from_product_name)
         DO UPDATE SET to_product_id = $2, created_by = $3`,
        fromProduct.product_name,
        toProductId,
        auth.session.user.id
      );

      // Delete any alias mappings pointing to the source product (redirect them)
      // First, get all mappings pointing to the source
      const mappingsToRedirect = await tx.$queryRawUnsafe<Array<{ from_product_name: string }>>(
        `SELECT from_product_name FROM product_aliases WHERE to_product_id = $1`,
        fromProductId
      );

      // Update them to point to the new target instead
      if (mappingsToRedirect.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE product_aliases SET to_product_id = $1 WHERE to_product_id = $2`,
          toProductId,
          fromProductId
        );
      }

      // Delete the source product
      await tx.products.delete({
        where: { id: fromProductId }
      });

      return {
        unitsTransferred: updateResult.count,
        fromProductName: fromProduct.product_name,
        toProductName: toProduct.product_name,
        aliasesPreserved: 1 + mappingsToRedirect.length // The deleted product + any mappings it had
      };
    });

    onProductDeleted(fromProductId);

    return NextResponse.json({
      ok: true,
      message: `Merged "${result.fromProductName}" into "${result.toProductName}"`,
      unitsTransferred: result.unitsTransferred,
      aliasesPreserved: result.aliasesPreserved
    });

  } catch (error: any) {
    console.error("Failed to merge products:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to merge products" },
      { status: 500 }
    );
  }
}
