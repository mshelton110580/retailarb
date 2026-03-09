import { prisma } from "@/lib/db";
import { extractProductInfo } from "./product-parser";
import type { ProductInfo } from "./types";

// In-memory cache: productId → parsed ProductInfo
const cache = new Map<string, ProductInfo>();
let initialized = false;
let initializing: Promise<void> | null = null;

// Process items in batches to avoid concurrent connection rate limits
const BATCH_SIZE = 5;

async function processBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Ensure the cache is populated. On first call, loads all products
 * from the DB and parses their names in batches. Subsequent calls are no-ops.
 */
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  // Prevent concurrent initialization from parallel requests
  if (initializing) return initializing;

  initializing = (async () => {
    const products = await prisma.products.findMany({
      select: { id: true, product_name: true }
    });

    const results = await processBatches(products, async (p) => {
      const info = await extractProductInfo(p.product_name);
      return { id: p.id, info };
    });

    for (const { id, info } of results) {
      cache.set(id, info);
    }

    initialized = true;
    initializing = null;
  })();

  return initializing;
}

/**
 * Get all cached products with their parsed ProductInfo.
 */
export async function getCachedProducts(): Promise<Map<string, ProductInfo>> {
  await ensureInitialized();
  return cache;
}

/**
 * Notify the cache that a product was created or renamed.
 * Parses the name and stores/updates the entry.
 */
export async function onProductCreated(productId: string, productName: string): Promise<void> {
  const info = await extractProductInfo(productName);
  cache.set(productId, info);
}

/**
 * Notify the cache that a product was deleted.
 */
export function onProductDeleted(productId: string): void {
  cache.delete(productId);
}
