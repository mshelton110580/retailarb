import { prisma } from "@/lib/db";
import { extractProductInfo } from "./product-parser";
import type { ProductInfo } from "./types";

// In-memory cache: categoryId → parsed ProductInfo
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
 * Ensure the cache is populated. On first call, loads all categories
 * from the DB and parses their names in batches. Subsequent calls are no-ops.
 */
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  // Prevent concurrent initialization from parallel requests
  if (initializing) return initializing;

  initializing = (async () => {
    const categories = await prisma.item_categories.findMany({
      select: { id: true, category_name: true }
    });

    const results = await processBatches(categories, async (cat) => {
      const info = await extractProductInfo(cat.category_name);
      return { id: cat.id, info };
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
 * Get all cached categories with their parsed ProductInfo.
 */
export async function getCachedCategories(): Promise<Map<string, ProductInfo>> {
  await ensureInitialized();
  return cache;
}

/**
 * Notify the cache that a category was created or renamed.
 * Parses the name and stores/updates the entry.
 */
export async function onCategoryCreated(categoryId: string, categoryName: string): Promise<void> {
  const info = await extractProductInfo(categoryName);
  cache.set(categoryId, info);
}

/**
 * Notify the cache that a category was deleted.
 */
export function onCategoryDeleted(categoryId: string): void {
  cache.delete(categoryId);
}
