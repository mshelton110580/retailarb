import { prisma } from "@/lib/db";

/**
 * Extract product information including brand, model, color, and type.
 */
function extractProductInfo(title: string): {
  brand: string | null;
  fullModel: string | null;  // Full model like "TI-84 Plus CE"
  color: string | null;
  productType: string | null;
  coreTerms: string[];
} {
  const titleLower = title.toLowerCase();

  // Common brands to detect (with multi-word brands first for priority)
  const knownBrands = [
    "texas instruments", "western digital", "tp-link",
    "apple", "samsung", "sony", "microsoft", "dell", "hp", "lenovo", "asus",
    "nintendo", "xbox", "playstation", "ps5", "ps4", "bose", "beats", "jbl",
    "logitech", "razer", "corsair", "hyperx", "steelseries", "roku", "amazon",
    "google", "nest", "ring", "fitbit", "garmin", "gopro", "canon", "nikon",
    "panasonic", "lg", "tcl", "vizio", "toshiba", "sandisk",
    "seagate", "crucial", "kingston", "nvidia", "amd", "intel", "netgear",
    "linksys", "belkin", "anker", "aukey", "ravpower", "powerbeats"
  ];

  let brand: string | null = null;
  for (const b of knownBrands) {
    if (titleLower.includes(b)) {
      brand = b;
      break;
    }
  }

  // Colors to detect (including common variants)
  const colors = new Set([
    "black", "white", "silver", "gray", "grey", "gold", "rose gold", "space gray",
    "blue", "navy", "light blue", "dark blue", "red", "pink", "coral", "purple",
    "green", "lime", "mint", "yellow", "orange", "brown", "tan", "beige",
    "graphite", "midnight", "starlight", "sierra blue", "alpine green"
  ]);

  let color: string | null = null;
  // Check for multi-word colors first
  const multiWordColors = ["rose gold", "space gray", "light blue", "dark blue", "sierra blue", "alpine green"];
  for (const c of multiWordColors) {
    if (titleLower.includes(c)) {
      color = c;
      break;
    }
  }
  // Then check single-word colors
  if (!color) {
    const words = titleLower.split(/\s+/);
    for (const word of words) {
      if (colors.has(word)) {
        color = word;
        break;
      }
    }
  }

  // Extract full model number (more comprehensive patterns)
  // Patterns like "TI-84 Plus CE", "MX Master 3", "WH-1000XM4", "Series 7", etc.
  const modelPatterns = [
    /\b([a-z]{2,4}[-\s]?\d{2,4}\s*(?:plus|pro|max|mini|ultra|ce|se)?(?:\s*[a-z]{1,2})?)\b/gi,
    /\b(gen\s?\d+|series\s?\d+|generation\s?\d+)\b/gi,
    /\b(v\d+|mark\s?\d+|mk\s?\d+)\b/gi,
  ];

  let fullModel: string | null = null;
  for (const pattern of modelPatterns) {
    const matches = title.match(pattern);
    if (matches && matches.length > 0) {
      // Get the longest match (most complete model)
      fullModel = matches.sort((a, b) => b.length - a.length)[0].trim();
      break;
    }
  }

  // Common product types
  const productTypes = new Set([
    "calculator", "graphing calculator", "scientific calculator",
    "controller", "console", "headset", "headphones", "earbuds", "keyboard",
    "mouse", "monitor", "laptop", "tablet", "phone", "smartphone", "watch", "smartwatch",
    "camera", "drone", "speaker", "soundbar", "receiver", "amplifier",
    "router", "modem", "switch", "hub", "adapter", "cable", "charger",
    "battery", "case", "cover", "screen protector", "drive", "ssd", "hdd",
    "ram", "memory", "memory card", "microsd", "flash drive",
    "pen", "stylus", "remote", "gamepad", "joystick", "racing wheel"
  ]);

  let productType: string | null = null;
  // Check multi-word product types first
  for (const type of ["graphing calculator", "scientific calculator", "screen protector", "memory card", "flash drive", "racing wheel", "smartwatch", "smartphone"]) {
    if (titleLower.includes(type)) {
      productType = type;
      break;
    }
  }
  // Then check single-word types
  if (!productType) {
    const words = titleLower.split(/\s+/);
    for (const word of words) {
      if (productTypes.has(word)) {
        productType = word;
        break;
      }
    }
  }

  // Extract core terms (excluding stopwords)
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "should",
    "could", "may", "might", "must", "can", "new", "used", "free", "shipping",
    "fast", "quick", "best", "great", "good", "nice", "box", "package", "bundle"
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  const coreTerms: string[] = [];

  // Add product type if found
  if (productType) {
    coreTerms.push(productType);
  }

  // Add brand if found
  if (brand) {
    coreTerms.push(brand);
  }

  // Add full model if found
  if (fullModel) {
    coreTerms.push(fullModel.toLowerCase());
  }

  // Add color if found
  if (color) {
    coreTerms.push(color);
  }

  // Add other significant terms (avoid duplicates)
  const existingTermsSet = new Set(coreTerms);
  for (const word of words) {
    if (!existingTermsSet.has(word) && coreTerms.length < 8) {
      coreTerms.push(word);
    }
  }

  return {
    brand,
    fullModel,
    color,
    productType,
    coreTerms: [...new Set(coreTerms)]
  };
}

/**
 * Detect if a title contains multiple distinct products (e.g., "TI-84 & TI-83")
 */
export function detectMultipleProducts(title: string): boolean {
  const titleLower = title.toLowerCase();

  // Common separators indicating multiple products
  const multiProductPatterns = [
    /\s+&\s+/,           // " & "
    /\s+and\s+/,        // " and "
    /\s+\+\s+/,         // " + "
    /\s+with\s+/,       // " with " (sometimes indicates bundle)
  ];

  // Check for model number patterns on both sides of separator
  const modelPattern = /\b([a-z]{2,4}[-\s]?\d{2,4}\s*(?:plus|pro|max|mini|ultra|ce|se)?)\b/gi;
  const models = title.match(modelPattern);

  // If we find 2+ distinct model numbers, likely multiple products
  if (models && models.length >= 2) {
    const uniqueModels = new Set(models.map(m => m.toLowerCase().trim()));
    if (uniqueModels.size >= 2) {
      return true;
    }
  }

  // Check for explicit multi-product language
  if (titleLower.includes("lot of") || titleLower.includes("bundle of") || titleLower.includes("set of")) {
    return true;
  }

  return false;
}

/**
 * Generate a category name from product info.
 * Format: "Brand Model Color" or "Model Color" or "Brand ProductType Color"
 * Examples: "TI-84 Plus CE Pink", "Xbox Controller Black", "Sony Headphones Blue"
 */
export function generateCategoryName(title: string): string {
  const { brand, fullModel, color, productType } = extractProductInfo(title);

  const parts: string[] = [];

  // If we have a full model, that's the most specific identifier
  if (fullModel) {
    parts.push(fullModel);
    if (color) {
      parts.push(color);
    }
  }
  // Otherwise use brand + product type
  else if (brand && productType) {
    parts.push(brand);
    parts.push(productType);
    if (color) {
      parts.push(color);
    }
  }
  // Just product type + color
  else if (productType) {
    parts.push(productType);
    if (color) {
      parts.push(color);
    }
  }
  // Fallback to first few words
  else {
    const words = title.split(/\s+/).filter(w => w.length > 2);
    parts.push(...words.slice(0, 3));
  }

  const name = parts.join(" ");

  // Capitalize first letter of each word
  return name
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 60); // Max 60 chars
}

/**
 * Calculate similarity score between two items.
 * Color must match for items to be considered the same category.
 */
function calculateSimilarity(
  item1: { brand: string | null; fullModel: string | null; color: string | null; productType: string | null; coreTerms: string[] },
  item2: { brand: string | null; fullModel: string | null; color: string | null; productType: string | null; coreTerms: string[] }
): number {
  let score = 0;
  let maxScore = 0;

  // CRITICAL: Color must match or both be null (30% of score)
  maxScore += 30;
  if (item1.color && item2.color) {
    if (item1.color === item2.color) {
      score += 30;
    } else {
      // Different colors = different category, return 0
      return 0;
    }
  } else if (!item1.color && !item2.color) {
    // Both have no color specified - that's okay
    score += 15; // Half credit
  }
  // One has color, one doesn't - partial credit (10 points)
  else {
    score += 10;
  }

  // Full model match is worth 35 points (most important)
  maxScore += 35;
  if (item1.fullModel && item2.fullModel) {
    if (item1.fullModel.toLowerCase() === item2.fullModel.toLowerCase()) {
      score += 35;
    } else {
      // Check if models are similar (e.g., "ti-84" in both "ti-84 plus" and "ti-84 plus ce")
      const model1Base = item1.fullModel.toLowerCase().split(/\s+/)[0];
      const model2Base = item2.fullModel.toLowerCase().split(/\s+/)[0];
      if (model1Base === model2Base && model1Base.length > 3) {
        score += 15; // Partial match
      }
    }
  }

  // Brand match is worth 20 points
  maxScore += 20;
  if (item1.brand && item2.brand && item1.brand === item2.brand) {
    score += 20;
  }

  // Product type match is worth 15 points
  maxScore += 15;
  if (item1.productType && item2.productType && item1.productType === item2.productType) {
    score += 15;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Find or create an item category based on GTIN or title analysis.
 * Returns category info and confidence level.
 */
export async function findOrCreateCategory(
  gtin: string | null,
  title: string
): Promise<{
  categoryId: string | null;
  confidence: "high" | "medium" | "low";
  requiresManualSelection: boolean;
  reason?: string;
  suggestedCategoryName?: string;
}> {
  // Check for multiple products in title
  const hasMultipleProducts = detectMultipleProducts(title);
  if (hasMultipleProducts) {
    return {
      categoryId: null,
      confidence: "low",
      requiresManualSelection: true,
      reason: "Multiple products detected in title"
    };
  }

  // If GTIN is available, try exact GTIN match first
  if (gtin) {
    const existing = await prisma.item_categories.findUnique({
      where: { gtin },
      select: { id: true }
    });

    if (existing) {
      return {
        categoryId: existing.id,
        confidence: "high",
        requiresManualSelection: false,
        reason: "Exact GTIN match"
      };
    }

    // GTIN provided but no match - create new with high confidence
    const { brand, fullModel, color, productType, coreTerms } = extractProductInfo(title);
    const categoryName = generateCategoryName(title);

    const newCategory = await prisma.item_categories.create({
      data: {
        gtin,
        category_name: categoryName,
        category_keywords: coreTerms
      }
    });

    return {
      categoryId: newCategory.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "New category created with GTIN"
    };
  }

  // No GTIN - use brand/model/color/type matching
  const itemInfo = extractProductInfo(title);

  if (itemInfo.coreTerms.length === 0) {
    return {
      categoryId: null,
      confidence: "low",
      requiresManualSelection: true,
      reason: "No meaningful terms found in title"
    };
  }

  // Generate category name for this item
  const categoryName = generateCategoryName(title);
  const normalizedName = categoryName.toLowerCase().trim();

  // Check for existing category merge mapping first
  const existingMerge = await prisma.$queryRawUnsafe<Array<{ to_category_id: string }>>(
    `SELECT to_category_id FROM category_merges WHERE LOWER(TRIM(from_category_name)) = $1`,
    normalizedName
  );

  if (existingMerge && existingMerge.length > 0) {
    return {
      categoryId: existingMerge[0].to_category_id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "Auto-merged based on previous selection"
    };
  }

  // Find categories and calculate similarity
  const allCategories = await prisma.item_categories.findMany({
    select: { id: true, category_keywords: true, category_name: true }
  });

  // Check for exact name match (case-insensitive)
  const exactMatch = allCategories.find(
    cat => cat.category_name.toLowerCase().trim() === normalizedName
  );

  if (exactMatch) {
    return {
      categoryId: exactMatch.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: "Exact category name match"
    };
  }

  let bestMatch: { id: string; score: number } | null = null;

  for (const category of allCategories) {
    // Reconstruct category info from stored keywords and name
    const categoryInfo = extractProductInfo(category.category_name);

    const score = calculateSimilarity(itemInfo, categoryInfo);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: category.id, score };
    }
  }

  // High confidence: 90%+ match
  if (bestMatch && bestMatch.score >= 0.9) {
    return {
      categoryId: bestMatch.id,
      confidence: "high",
      requiresManualSelection: false,
      reason: `High similarity match (${Math.round(bestMatch.score * 100)}%)`
    };
  }

  // Medium confidence: 70-89% match
  if (bestMatch && bestMatch.score >= 0.7) {
    return {
      categoryId: bestMatch.id,
      confidence: "medium",
      requiresManualSelection: false,
      reason: `Medium similarity match (${Math.round(bestMatch.score * 100)}%)`
    };
  }

  // Low confidence or no match - require manual selection
  if (bestMatch && bestMatch.score >= 0.5) {
    return {
      categoryId: bestMatch.id,
      confidence: "low",
      requiresManualSelection: true,
      reason: `Low similarity match (${Math.round(bestMatch.score * 100)}%) - manual confirmation needed`
    };
  }

  // No good match - ALWAYS require manual selection for new categories
  // This allows user to merge with existing similar categories
  return {
    categoryId: null,
    confidence: "low",
    requiresManualSelection: true,
    reason: `New category "${categoryName}" - select existing to merge or confirm new`,
    suggestedCategoryName: categoryName
  };
}

/**
 * Compute inventory state based on condition status and return status.
 *
 * States:
 *   on_hand        — good condition, no return issue, physically on-hand
 *   to_be_returned — bad condition (needs return filed) OR open return filed not yet shipped
 *   parts_repair   — closed return + refund received, item kept (compensated, can part/scrap)
 *   returned       — physically shipped or delivered back to seller
 *   missing        — unit was never physically received (lot short-ship); set only by add-unit
 */
export function computeInventoryState(
  conditionStatus: string,
  hasReturnFiled: boolean = false,
  hasRefundWithoutReturn: boolean = false,
  hasReturnShipped: boolean = false
): string {
  // Return physically shipped/delivered: only non-good units are returned;
  // good-condition units in the same lot are kept on hand.
  if (hasReturnShipped) {
    const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
    if (!goodConditions.has(conditionStatus?.toLowerCase() ?? "")) {
      return "returned";
    }
    // good condition — fall through to normal state calculation
  }

  // Closed return with refund received — we kept the item and were compensated
  if (hasRefundWithoutReturn) {
    return "parts_repair";
  }

  // Open return filed, or bad condition with no return yet — needs return action
  if (hasReturnFiled) {
    return "to_be_returned";
  }

  const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
  if (!goodConditions.has(conditionStatus?.toLowerCase() ?? "")) {
    // Bad condition, no return filed yet — flag for return action
    return "to_be_returned";
  }

  return "on_hand";
}
