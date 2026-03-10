import { prisma } from "@/lib/db";
import { extractProductInfo, generateProductName, getCachedProducts, onProductCreated } from "@/lib/ai";
import type { ProductInfo } from "@/lib/ai";

// Re-export for consumers that import from this module
export { generateProductName };

/**
 * Detect if a title contains multiple distinct products (e.g., "TI-84 & TI-83")
 */
export function detectMultipleProducts(title: string): boolean {
  const titleLower = title.toLowerCase();

  // Check for model number patterns — must look like real product models.
  // Filter out false positives like "of 24", "Lot 10" which match [a-z]{2}[0-9]{2}.
  const modelPattern = /\b([a-z]{2,4}[-\s]?\d{2,4}\s*(?:plus|pro|max|mini|ultra|ce|se)?)\b/gi;
  const models = title.match(modelPattern);
  const noiseWords = new Set(["of", "lot", "set", "box", "qty", "new", "for"]);

  if (models && models.length >= 2) {
    const realModels = models.filter(m => {
      const prefix = m.replace(/[-\s]?\d+.*$/, "").toLowerCase();
      return !noiseWords.has(prefix);
    });
    const uniqueModels = new Set(realModels.map(m => m.toLowerCase().trim()));
    if (uniqueModels.size >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate similarity score between two product infos.
 * Color must match for items to be considered the same product.
 * Uses normalized comparison (strips formatting) for model matching.
 */
function calculateSimilarity(
  item1: ProductInfo,
  item2: ProductInfo
): number {
  let score = 0;
  let maxScore = 0;

  // CRITICAL: Color must match or both be null (30% of score)
  maxScore += 30;
  const color1 = item1.color?.toLowerCase() ?? null;
  const color2 = item2.color?.toLowerCase() ?? null;
  if (color1 && color2) {
    if (color1 === color2) {
      score += 30;
    } else {
      return 0;
    }
  } else if (!color1 && !color2) {
    score += 15;
  } else {
    score += 10;
  }

  // Product line + model + variant match (35 points — most important)
  maxScore += 35;
  const fullModel1 = [item1.productLine, item1.model, item1.variantEdition].filter(Boolean).join(" ").toLowerCase();
  const fullModel2 = [item2.productLine, item2.model, item2.variantEdition].filter(Boolean).join(" ").toLowerCase();
  if (fullModel1 && fullModel2) {
    // Normalize: strip all non-alphanumeric for comparison
    const norm1 = fullModel1.replace(/[^a-z0-9]/g, "");
    const norm2 = fullModel2.replace(/[^a-z0-9]/g, "");
    if (norm1 === norm2) {
      score += 35;
    } else if (norm1.startsWith(norm2) || norm2.startsWith(norm1)) {
      // Partial match — scale by how much of the longer string is covered.
      // "ti84plusce" vs "ti84pluscepython" = 9/16 = 56% coverage → ~31 pts
      // "ti84plus" vs "ti84pluscepython" = 8/16 = 50% coverage → ~28 pts
      const longer = Math.max(norm1.length, norm2.length);
      const shorter = Math.min(norm1.length, norm2.length);
      const coverage = shorter / longer;
      score += Math.round(20 + 15 * coverage);
    }
  }

  // Brand match is worth 20 points
  maxScore += 20;
  if (item1.brand && item2.brand && item1.brand.toLowerCase() === item2.brand.toLowerCase()) {
    score += 20;
  }

  // Product type match is worth 15 points
  maxScore += 15;
  if (item1.productType && item2.productType && item1.productType.toLowerCase() === item2.productType.toLowerCase()) {
    score += 15;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Find or create a product based on GTIN or title analysis.
 * Uses AI-powered product parsing for title analysis with regex fallback.
 * Returns product info and confidence level.
 */
export async function findOrCreateProduct(
  gtin: string | null,
  title: string,
  precomputedInfo?: ProductInfo | null
): Promise<{
  productId: string | null;
  confidence: "high" | "medium" | "low";
  requiresManualSelection: boolean;
  reason?: string;
  suggestedProductName?: string;
}> {
  // Check for multiple products in title
  const hasMultipleProducts = detectMultipleProducts(title);
  if (hasMultipleProducts) {
    return {
      productId: null,
      confidence: "low",
      requiresManualSelection: true,
      reason: "Multiple products detected in title"
    };
  }

  // If GTIN is available, try exact GTIN match first
  if (gtin) {
    const existing = await prisma.products.findUnique({
      where: { gtin },
      select: { id: true }
    });

    if (existing) {
      return {
        productId: existing.id,
        confidence: "high",
        requiresManualSelection: false,
        reason: "Exact GTIN match"
      };
    }

    // GTIN provided but no GTIN match — check for name match before creating.
    // An existing product may just be missing its GTIN.
    const itemInfo = precomputedInfo ?? await extractProductInfo(title);
    const normalizedName = itemInfo.canonicalName.toLowerCase().trim();

    const allProducts = await prisma.products.findMany({
      select: { id: true, product_name: true, gtin: true }
    });

    const nameMatch = allProducts.find(
      p => p.product_name.toLowerCase().trim() === normalizedName
    );

    if (nameMatch) {
      // Found existing product by name — backfill its GTIN if empty
      if (!nameMatch.gtin) {
        await prisma.products.update({
          where: { id: nameMatch.id },
          data: { gtin }
        }).catch(() => {}); // Ignore if another product already has this GTIN
      }
      return {
        productId: nameMatch.id,
        confidence: "high",
        requiresManualSelection: false,
        reason: "Name match (GTIN backfilled)"
      };
    }

    const newProduct = await prisma.products.create({
      data: {
        gtin,
        product_name: itemInfo.canonicalName,
        product_keywords: itemInfo.coreTerms
      }
    });

    await onProductCreated(newProduct.id, itemInfo.canonicalName);

    return {
      productId: newProduct.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "New product created with GTIN"
    };
  }

  // No GTIN - use AI-powered brand/model/color/type matching
  const itemInfo = precomputedInfo ?? await extractProductInfo(title);

  if (itemInfo.coreTerms.length === 0) {
    return {
      productId: null,
      confidence: "low",
      requiresManualSelection: true,
      reason: "No meaningful terms found in title"
    };
  }

  const productName = itemInfo.canonicalName;
  const normalizedName = productName.toLowerCase().trim();

  // Check for existing product alias mapping first
  const existingMerge = await prisma.$queryRawUnsafe<Array<{ to_product_id: string }>>(
    `SELECT to_product_id FROM product_aliases WHERE LOWER(TRIM(from_product_name)) = $1`,
    normalizedName
  );

  if (existingMerge && existingMerge.length > 0) {
    return {
      productId: existingMerge[0].to_product_id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "Auto-merged based on previous selection"
    };
  }

  // Use cached parsed ProductInfo for all products (no API calls)
  const cachedProducts = await getCachedProducts();

  // Check for exact name match (case-insensitive) via DB
  const allProducts = await prisma.products.findMany({
    select: { id: true, product_name: true }
  });

  const exactMatch = allProducts.find(
    p => p.product_name.toLowerCase().trim() === normalizedName
  );

  if (exactMatch) {
    return {
      productId: exactMatch.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "Exact product name match"
    };
  }

  let bestMatch: { id: string; score: number } | null = null;

  // First pass: check if canonicalName is contained in a product name (or vice versa)
  // This catches cases where AI field parsing is inconsistent but names clearly match
  const normCanonical = normalizedName.replace(/[^a-z0-9]/g, "");
  for (const p of allProducts) {
    const normProdName = p.product_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normCanonical && normProdName) {
      if (normProdName.startsWith(normCanonical) || normCanonical.startsWith(normProdName)) {
        const longer = Math.max(normCanonical.length, normProdName.length);
        const shorter = Math.min(normCanonical.length, normProdName.length);
        const coverage = shorter / longer;
        if (coverage >= 0.7) {
          const nameScore = 0.75 + 0.2 * coverage;
          if (!bestMatch || nameScore > bestMatch.score) {
            bestMatch = { id: p.id, score: nameScore };
          }
        }
      }
    }
  }

  // Second pass: AI-parsed field similarity scoring
  for (const [productId, productInfo] of cachedProducts) {
    const simScore = calculateSimilarity(itemInfo, productInfo);

    if (simScore > 0 && (!bestMatch || simScore > bestMatch.score)) {
      bestMatch = { id: productId, score: simScore };
    }
  }

  // High confidence: 90%+ match
  if (bestMatch && bestMatch.score >= 0.9) {
    return {
      productId: bestMatch.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: `High similarity match (${Math.round(bestMatch.score * 100)}%)`
    };
  }

  // Medium confidence: 70-89% match
  if (bestMatch && bestMatch.score >= 0.7) {
    return {
      productId: bestMatch.id,
      confidence: "medium",
      requiresManualSelection: false,
      reason: `Medium similarity match (${Math.round(bestMatch.score * 100)}%)`
    };
  }

  // Low confidence or no match - require manual selection
  if (bestMatch && bestMatch.score >= 0.5) {
    return {
      productId: bestMatch.id,
      confidence: "low",
      requiresManualSelection: true,
      reason: `Low similarity match (${Math.round(bestMatch.score * 100)}%) - manual confirmation needed`
    };
  }

  // No good match - ALWAYS require manual selection for new products
  return {
    productId: null,
    confidence: "low",
    requiresManualSelection: true,
    reason: `New product "${productName}" - select existing to merge or confirm new`,
    suggestedProductName: productName
  };
}

/**
 * Compute inventory state based on condition status and return status.
 *
 * States:
 *   on_hand        — good condition, no return issue, physically on-hand
 *   to_be_returned — bad condition (needs return filed) OR open return filed not yet shipped
 *   fair           — damaged condition + refund without return delivery (sellable at fair condition)
 *   parts_repair   — closed return + refund received, item kept (defective/broken, can part/scrap)
 *   returned       — physically shipped or delivered back to seller
 *   missing        — unit was never physically received (lot short-ship); set only by add-unit
 */
export function computeInventoryState(
  conditionStatus: string,
  hasReturnFiled: boolean = false,
  hasRefundWithoutReturn: boolean = false,
  hasReturnShipped: boolean = false
): string {
  // Missing units were never physically received — not inventory
  if (conditionStatus?.toLowerCase() === "missing") {
    return "missing";
  }

  if (hasReturnShipped) {
    const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
    if (!goodConditions.has(conditionStatus?.toLowerCase() ?? "")) {
      return "returned";
    }
  }

  if (hasRefundWithoutReturn) {
    return conditionStatus?.toLowerCase() === "damaged" ? "fair" : "parts_repair";
  }

  if (hasReturnFiled) {
    return "to_be_returned";
  }

  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
  if (!goodConditions.has(conditionStatus?.toLowerCase() ?? "")) {
    return "to_be_returned";
  }

  return "on_hand";
}
