import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { onProductCreated } from "@/lib/ai";

const schema = z.object({
  productName: z.string().min(1).max(60),
  gtin: z.string().nullable().optional()
});

/**
 * POST /api/products/create - Create a new product manually
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Check if product with this name already exists
    const existing = await prisma.products.findFirst({
      where: {
        product_name: {
          equals: body.data.productName,
          mode: 'insensitive'
        }
      }
    });

    if (existing) {
      return NextResponse.json({
        error: "Product with this name already exists",
        existingProduct: existing
      }, { status: 409 });
    }

    // Create the product
    const product = await prisma.products.create({
      data: {
        product_name: body.data.productName.trim(),
        gtin: body.data.gtin || null,
        product_keywords: []
      }
    });

    await onProductCreated(product.id, product.product_name);

    return NextResponse.json({
      ok: true,
      product
    });

  } catch (error: any) {
    console.error("Failed to create product:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create product" },
      { status: 500 }
    );
  }
}
