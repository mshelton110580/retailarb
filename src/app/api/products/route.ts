import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { onProductCreated, onProductDeleted } from "@/lib/ai";

/**
 * GET /api/products - List all products (deduplicated)
 */
export async function GET() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const allProducts = await prisma.products.findMany({
    select: {
      id: true,
      product_name: true,
      gtin: true,
      product_keywords: true
    },
    orderBy: {
      product_name: 'asc'
    }
  });

  // Deduplicate by product_name (case-insensitive)
  // Keep the first occurrence of each unique name
  const seen = new Map<string, typeof allProducts[0]>();
  for (const cat of allProducts) {
    const normalized = cat.product_name.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.set(normalized, cat);
    }
  }

  const products = Array.from(seen.values()).sort((a, b) =>
    a.product_name.localeCompare(b.product_name)
  );

  return NextResponse.json({ products });
}

const createSchema = z.object({
  name: z.string().min(1, "Product name is required")
});

/**
 * POST /api/products - Create a new product
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok || !auth.session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = createSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Check if product already exists (case-insensitive)
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string; product_name: string }>>(
      `SELECT id, product_name FROM products WHERE LOWER(TRIM(product_name)) = $1 LIMIT 1`,
      body.data.name.toLowerCase().trim()
    );

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Product "${existing[0].product_name}" already exists`, product: existing[0] },
        { status: 409 }
      );
    }

    // Create new product
    const product = await prisma.products.create({
      data: {
        product_name: body.data.name,
        gtin: null
      }
    });

    await onProductCreated(product.id, product.product_name);

    return NextResponse.json({ product, message: `Product "${product.product_name}" created successfully` });
  } catch (error: any) {
    console.error("Failed to create product:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to create product" },
      { status: 500 }
    );
  }
}

const deleteSchema = z.object({
  productId: z.string().min(1, "Product ID is required")
});

/**
 * DELETE /api/products - Delete a product (only if it has no units)
 */
export async function DELETE(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = deleteSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const product = await prisma.products.findUnique({
      where: { id: body.data.productId },
      select: {
        id: true,
        product_name: true,
        _count: { select: { received_units: true } }
      }
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (product._count.received_units > 0) {
      return NextResponse.json(
        { error: `Cannot delete "${product.product_name}" — it has ${product._count.received_units} unit(s) assigned` },
        { status: 409 }
      );
    }

    // Delete any merge mappings pointing to this product
    await prisma.$executeRawUnsafe(
      `DELETE FROM product_aliases WHERE to_product_id = $1`,
      product.id
    );

    await prisma.products.delete({ where: { id: product.id } });
    await onProductDeleted(product.id);

    return NextResponse.json({ message: `Product "${product.product_name}" deleted` });
  } catch (error: any) {
    console.error("Failed to delete product:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to delete product" },
      { status: 500 }
    );
  }
}
