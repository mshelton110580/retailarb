import { getAnthropicClient } from "./client";
import { ProductInfo, ProductAndLotInfo } from "./types";
import { PRODUCT_PARSING_SYSTEM_PROMPT, PRODUCT_INFO_TOOL, PRODUCT_AND_LOT_SYSTEM_PROMPT, PRODUCT_AND_LOT_TOOL } from "./prompts/product-parsing";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_CACHE_SIZE = 500;

// In-memory cache keyed on normalized title
const cache = new Map<string, ProductInfo>();

function normalizeKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildCoreTerms(info: Omit<ProductInfo, "coreTerms">): string[] {
  const terms: string[] = [];
  if (info.productType) terms.push(info.productType.toLowerCase());
  if (info.brand) terms.push(info.brand.toLowerCase());
  if (info.productLine) terms.push(info.productLine.toLowerCase());
  if (info.model) terms.push(info.model.toLowerCase());
  if (info.variantEdition) terms.push(info.variantEdition.toLowerCase());
  if (info.color) terms.push(info.color.toLowerCase());
  return [...new Set(terms)];
}

export async function extractProductInfo(title: string): Promise<ProductInfo> {
  const key = normalizeKey(title);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      temperature: 0,
      system: PRODUCT_PARSING_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Extract product info from this listing title:\n\n"${title}"` }
      ],
      tools: [PRODUCT_INFO_TOOL],
      tool_choice: { type: "tool", name: "extract_product_info" }
    });

    const toolBlock = response.content.find(block => block.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("No tool_use block in response");
    }

    const input = toolBlock.input as Record<string, string>;

    const info: ProductInfo = {
      brand: input.brand || null,
      productLine: input.productLine || null,
      model: input.model || null,
      variantEdition: input.variantEdition || null,
      color: input.color || null,
      productType: input.productType || null,
      canonicalName: input.canonicalName || title.slice(0, 60),
      coreTerms: []
    };
    info.coreTerms = buildCoreTerms(info);

    // Manage cache size
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, info);

    return info;
  } catch (error) {
    console.error("AI product parsing failed, using fallback:", error);
    return extractProductInfoFallback(title);
  }
}

/**
 * Combined product parsing + lot detection in a single API call.
 * Used on first scan to detect lots from title analysis.
 */
export async function extractProductAndLotInfo(title: string, qty: number, description?: string | null, productNames?: string[]): Promise<ProductAndLotInfo> {
  try {
    const client = getAnthropicClient();
    let userMessage = `Listing title: "${title}"\nPurchase quantity: ${qty}`;
    if (description) {
      userMessage += `\n\nListing description:\n${description}`;
    }
    if (productNames && productNames.length > 0) {
      userMessage += `\n\nTracked inventory products:\n${productNames.join(", ")}`;
    }
    userMessage += `\n\nExtract product info and detect if this is a lot.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0,
      system: PRODUCT_AND_LOT_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userMessage }
      ],
      tools: [PRODUCT_AND_LOT_TOOL],
      tool_choice: { type: "tool", name: "analyze_listing" }
    });

    const toolBlock = response.content.find(block => block.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("No tool_use block in response");
    }

    const input = toolBlock.input as Record<string, any>;

    const product: ProductInfo = {
      brand: input.brand || null,
      productLine: input.productLine || null,
      model: input.model || null,
      variantEdition: input.variantEdition || null,
      color: input.color || null,
      productType: input.productType || null,
      canonicalName: input.canonicalName || title.slice(0, 60),
      coreTerms: []
    };
    product.coreTerms = buildCoreTerms(product);

    // Cache the product info too
    const key = normalizeKey(title);
    if (!cache.has(key)) {
      if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }
      cache.set(key, product);
    }

    return {
      product,
      lot: {
        isLot: input.isLot ?? false,
        itemsPerUnit: input.itemsPerUnit ?? 1,
        itemBreakdown: Array.isArray(input.itemBreakdown) ? input.itemBreakdown : [],
        confidence: input.lotConfidence ?? "low"
      }
    };
  } catch (error) {
    console.error("AI product+lot parsing failed, using fallback:", error);
    const product = extractProductInfoFallback(title);
    return {
      product,
      lot: { isLot: false, itemsPerUnit: 1, itemBreakdown: [], confidence: "low" }
    };
  }
}

export async function generateProductName(title: string): Promise<string> {
  const info = await extractProductInfo(title);
  return info.canonicalName;
}

/**
 * Regex-based fallback when the AI service is unavailable.
 * This is the original extraction logic preserved for graceful degradation.
 */
function extractProductInfoFallback(title: string): ProductInfo {
  const titleLower = title.toLowerCase();

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

  const colors = new Set([
    "black", "white", "silver", "gray", "grey", "gold", "rose gold", "space gray",
    "blue", "navy", "light blue", "dark blue", "red", "pink", "coral", "purple",
    "green", "lime", "mint", "yellow", "orange", "brown", "tan", "beige",
    "graphite", "midnight", "starlight", "sierra blue", "alpine green"
  ]);

  let color: string | null = null;
  const multiWordColors = ["rose gold", "space gray", "light blue", "dark blue", "sierra blue", "alpine green"];
  for (const c of multiWordColors) {
    if (titleLower.includes(c)) {
      color = c;
      break;
    }
  }
  if (!color) {
    const words = titleLower.split(/\s+/);
    for (const word of words) {
      if (colors.has(word)) {
        color = word;
        break;
      }
    }
  }

  const modelPatterns = [
    /\b([a-z]{2,4}[-\s]?\d{2,4}\s*(?:plus|pro|max|mini|ultra|ce|se)?(?:\s*[a-z]{1,2})?)\b/gi,
    /\b(gen\s?\d+|series\s?\d+|generation\s?\d+)\b/gi,
    /\b(v\d+|mark\s?\d+|mk\s?\d+)\b/gi,
  ];

  let fullModel: string | null = null;
  for (const pattern of modelPatterns) {
    const matches = title.match(pattern);
    if (matches && matches.length > 0) {
      fullModel = matches.sort((a, b) => b.length - a.length)[0].trim();
      break;
    }
  }

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
  for (const type of ["graphing calculator", "scientific calculator", "screen protector", "memory card", "flash drive", "racing wheel", "smartwatch", "smartphone"]) {
    if (titleLower.includes(type)) {
      productType = type;
      break;
    }
  }
  if (!productType) {
    const words = titleLower.split(/\s+/);
    for (const word of words) {
      if (productTypes.has(word)) {
        productType = word;
        break;
      }
    }
  }

  // Generate canonical name using fallback logic
  const parts: string[] = [];
  if (fullModel) {
    parts.push(fullModel);
    if (color) parts.push(color);
  } else if (brand && productType) {
    parts.push(brand);
    parts.push(productType);
    if (color) parts.push(color);
  } else if (productType) {
    parts.push(productType);
    if (color) parts.push(color);
  } else {
    const words = title.split(/\s+/).filter(w => w.length > 2);
    parts.push(...words.slice(0, 3));
  }

  const canonicalName = parts
    .join(" ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 60);

  const coreTerms: string[] = [];
  if (productType) coreTerms.push(productType);
  if (brand) coreTerms.push(brand);
  if (fullModel) coreTerms.push(fullModel.toLowerCase());
  if (color) coreTerms.push(color);

  return {
    brand,
    productLine: fullModel,
    model: null,
    variantEdition: null,
    color,
    productType,
    canonicalName,
    coreTerms: [...new Set(coreTerms)]
  };
}
