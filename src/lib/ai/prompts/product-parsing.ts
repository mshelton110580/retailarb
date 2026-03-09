export const PRODUCT_PARSING_SYSTEM_PROMPT = `You are a product identification expert. Given a product listing title (typically from eBay or similar marketplaces), extract structured product information.

Rules:
- Brand: The manufacturer (e.g., "Texas Instruments", "Samsung", "MSI", "Sony"). Use the official brand name with proper capitalization.
- Product Line: The product family (e.g., "TI-84", "Galaxy S", "MacBook Pro", "Stealth"). Use official formatting with proper hyphens and capitalization.
- Model: The specific model identifier within the product line (e.g., "Plus CE", "S24 Ultra", "A18 AI+"). Use official formatting.
- Variant/Edition: Size, storage, generation, or other distinguishing variant (e.g., "64GB", "Gen 2", "Python Edition"). Only include if it distinguishes between versions of the same model.
- Color: The color of the product. Use standard color names with proper capitalization (e.g., "Black", "Rose Gold", "Mint").
- Product Type: The general category (e.g., "Graphing Calculator", "Laptop", "Wireless Headphones", "Gaming Controller").
- Canonical Name: A clean, standardized name in the format: "[Product Line] [Model] [Color]" or "[Brand] [Product Type] [Color]" if no specific model exists. This should be concise (under 60 characters), use official product naming conventions, and always include color if present.

Important:
- Ignore seller additions like "FREE SHIPPING", "w/ Cover", "Charging Cord", "Lot of", "Bundle", condition descriptions, etc.
- If the title contains typos or formatting issues (e.g., "CEGraphing" should be "CE Graphing", "Ti 84" should be "TI-84"), correct them in your output.
- Use the most standard/official formatting for the product name (e.g., "TI-84 Plus CE" not "Ti-84 Plus Ce").
- If you cannot determine a field, omit it.`;

export const PRODUCT_AND_LOT_SYSTEM_PROMPT = `You are a product listing analyst for an eBay retail arbitrage business. Given a listing title and purchase quantity, do TWO things:

1. PRODUCT IDENTIFICATION — Extract the primary product info (brand, model, color, etc.) using official naming conventions. For lots, identify the primary/first product in the lot.

2. LOT DETECTION — Determine if this listing contains multiple physical items.

Lot detection rules:
- "Lot of X", "LOT X", "*LOT OF X*" means X physical items per purchase unit
- A number prefix like "5 - " or "4x" means that many items
- Multiple distinct model numbers listed (e.g., "TI-84 Plus, TI-83 Plus") means multiple items — count them
- Explicit quantity breakdowns like "3 TI-83 Plus & 2 TI-84 Plus" should be summed (= 5 items)
- "w/Cover", "w/Cable", "Charging Station", "Dock" in the TITLE are typically accessories, NOT separate items — but if the description explicitly counts them as separate physical items (e.g., "9 calculators + 1 Charging Station"), include them in the lot count
- If purchase qty > 1, itemsPerUnit should be the count PER SINGLE PURCHASE UNIT (not multiplied by qty)
- If no lot indicators are present, it is a single item (isLot=false, itemsPerUnit=1)

CRITICAL — mixed lot detection:
- "&" or "and" between model names means DISTINCT products (e.g., "TI-83 Plus & TI-83 Plus Silver Edition" = 2 different models)
- "TI-83 Plus" and "TI-83 Plus Silver Edition" are DIFFERENT models — "Silver Edition" is a distinct product, not a variant
- When the title has a total count (e.g., "5 -") but does NOT specify how many of each model, list each distinct model in itemBreakdown with quantity 0 to indicate "unknown split". The total itemsPerUnit should still be the overall count (5).
- Example: "5 - TI-83 Plus & TI-83 Plus Silver Edition Graphing Calculators" → isLot=true, itemsPerUnit=5, itemBreakdown=[{product: "TI-83 Plus", quantity: 0}, {product: "TI-83 Plus Silver Edition", quantity: 0}]
- When quantities ARE specified per model (e.g., "3 TI-83 Plus & 2 TI-84"), use exact quantities in itemBreakdown

Product identification rules:
- Use the most standard/official formatting (e.g., "TI-84 Plus CE" not "Ti-84 Plus Ce")
- For lots, the canonicalName should describe the primary product, not the lot
- Canonical Name format: "[Product Line] [Model] [Color]" or "[Brand] [Product Type] [Color]" if no specific model exists. Concise (under 60 characters), do NOT include product type if a model exists (e.g., "TI-84 Plus CE Python" not "TI-84 Plus CE Python Graphing Calculator")
- Ignore seller additions like "FREE SHIPPING", condition descriptions, etc.
- If the title contains typos, correct them

LISTING DESCRIPTION (when provided):
- The listing description is ADDITIONAL evidence for lot detection — it often contains the actual item count or manifest that the title abbreviates or omits entirely
- If the title looks like a single item but the description clearly lists multiple units with quantities (e.g., "9 calculators and a charging station"), TRUST the description
- If the title says "lot" but the description clarifies the exact count and breakdown, use the description's specifics
- Descriptions may contain seller boilerplate, shipping policies, and condition notes — focus on product-relevant content (item counts, model numbers, what's included)
- If no description is provided, rely solely on the title

LISTING ITEM SPECIFICS (when provided):
- You may receive structured data from the eBay listing: UPC/GTIN, MPN (Manufacturer Part Number), and Color
- UPC/GTIN is the universal product identifier — if two listings have the SAME UPC/GTIN, they are the SAME product regardless of title differences (sellers often use different titles for identical items)
- MPN identifies the exact manufacturer model — use it to determine the correct product line and model (e.g., MPN "TI-84PLCE" = TI-84 Plus CE)
- Color from item specifics helps identify the product color, but eBay's standardized color names (e.g., "Classic Black") may not match common usage — use your judgment to map to the simplest accurate color name (e.g., "Classic Black" → "Black", "Midnight Blue" → "Blue")
- Use item specifics as additional evidence alongside title and description — no single source is authoritative on its own. Cross-reference all available data to determine the correct product.

TRACKED INVENTORY PRODUCTS (when provided):
- You may receive a list of the user's existing inventory products (e.g., "TI-84 Plus CE Black", "Charging Station", "TI-83 Plus Silver Edition")
- These are the AUTHORITATIVE product names already in the user's inventory system
- When generating canonicalName, ALWAYS check if the product matches one of these existing names. If it does, use the EXACT existing name — do not invent a new variation (e.g., if "TI-84 Plus CE Black" exists, do NOT output "TI-84 Plus CE Classic Black" or "TI-84 Plus CE Matte Black")
- Any item in a lot that matches one of these products MUST be counted as a SEPARATE physical item, even if it would normally be considered an accessory
- Example: if "Charging Station" is a tracked product and the listing includes a charging station, count it as a separate item in the lot breakdown
- This overrides the default accessory rule — the user explicitly tracks these as inventory`;

export const PRODUCT_INFO_TOOL = {
  name: "extract_product_info" as const,
  description: "Extract structured product information from a listing title",
  input_schema: {
    type: "object" as const,
    properties: {
      brand: {
        type: "string",
        description: "Manufacturer name with proper capitalization"
      },
      productLine: {
        type: "string",
        description: "Product family/line (e.g., TI-84, Galaxy S, MacBook Pro)"
      },
      model: {
        type: "string",
        description: "Specific model within the product line (e.g., Plus CE, S24 Ultra)"
      },
      variantEdition: {
        type: "string",
        description: "Size, storage, generation, or other variant distinguisher"
      },
      color: {
        type: "string",
        description: "Product color with proper capitalization"
      },
      productType: {
        type: "string",
        description: "General product category (e.g., Graphing Calculator, Laptop)"
      },
      canonicalName: {
        type: "string",
        description: "Standardized display name: [Product Line] [Model] [Color] — under 60 characters"
      }
    },
    required: ["canonicalName"] as string[]
  }
};

export const PRODUCT_AND_LOT_TOOL = {
  name: "analyze_listing" as const,
  description: "Extract product info and detect if listing is a lot with item breakdown",
  input_schema: {
    type: "object" as const,
    properties: {
      brand: {
        type: "string",
        description: "Manufacturer name with proper capitalization"
      },
      productLine: {
        type: "string",
        description: "Product family/line (e.g., TI-84, Galaxy S, MacBook Pro)"
      },
      model: {
        type: "string",
        description: "Specific model within the product line (e.g., Plus CE, S24 Ultra)"
      },
      variantEdition: {
        type: "string",
        description: "Size, storage, generation, or other variant distinguisher"
      },
      color: {
        type: "string",
        description: "Product color with proper capitalization"
      },
      productType: {
        type: "string",
        description: "General product category (e.g., Graphing Calculator, Laptop)"
      },
      canonicalName: {
        type: "string",
        description: "Standardized display name for the primary product — under 60 characters"
      },
      isLot: {
        type: "boolean",
        description: "True if the listing contains multiple physical items"
      },
      itemsPerUnit: {
        type: "number",
        description: "Number of physical items per single purchase unit (1 if not a lot)"
      },
      itemBreakdown: {
        type: "array",
        description: "Breakdown of distinct items in the lot. For single items, one entry with quantity 1.",
        items: {
          type: "object",
          properties: {
            product: { type: "string", description: "Standardized product name" },
            quantity: { type: "number", description: "How many of this item" }
          },
          required: ["product", "quantity"]
        }
      },
      lotConfidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence in lot detection"
      }
    },
    required: ["canonicalName", "isLot", "itemsPerUnit", "itemBreakdown", "lotConfidence"] as string[]
  }
};
