import { extractProductInfo } from "@/lib/ai";
import type { ProductInfo } from "@/lib/ai";

// Mirror of the actual calculateSimilarity from item-categorization.ts
function calculateSimilarity(item1: ProductInfo, item2: ProductInfo): number {
  let score = 0;
  let maxScore = 0;

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

  maxScore += 35;
  const fullModel1 = [item1.productLine, item1.model, item1.variantEdition].filter(Boolean).join(" ").toLowerCase();
  const fullModel2 = [item2.productLine, item2.model, item2.variantEdition].filter(Boolean).join(" ").toLowerCase();
  if (fullModel1 && fullModel2) {
    const norm1 = fullModel1.replace(/[^a-z0-9]/g, "");
    const norm2 = fullModel2.replace(/[^a-z0-9]/g, "");
    if (norm1 === norm2) {
      score += 35;
    } else if (norm1.startsWith(norm2) || norm2.startsWith(norm1)) {
      const longer = Math.max(norm1.length, norm2.length);
      const shorter = Math.min(norm1.length, norm2.length);
      const coverage = shorter / longer;
      score += Math.round(20 + 15 * coverage);
    }
  }

  maxScore += 20;
  if (item1.brand && item2.brand && item1.brand.toLowerCase() === item2.brand.toLowerCase()) {
    score += 20;
  }

  maxScore += 15;
  if (item1.productType && item2.productType && item1.productType.toLowerCase() === item2.productType.toLowerCase()) {
    score += 15;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

async function test() {
  const item = await extractProductInfo("Texas Instruments TI-84 Plus CE Python Graphing Calculator");
  console.log("Scanned item:", JSON.stringify(item, null, 2));
  console.log("");

  const candidates = [
    "TI-84 Plus",
    "TI-84 Plus CE",
    "TI-84 Plus CE Black",
    "TI-84 Plus CE Python Black",
    "TI-84 Plus Black",
  ];

  for (const name of candidates) {
    const cat = await extractProductInfo(name);
    const pct = calculateSimilarity(item, cat);
    const m1 = [item.productLine, item.model, item.variantEdition].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    const m2 = [cat.productLine, cat.model, cat.variantEdition].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    console.log(
      name.padEnd(35),
      (pct * 100).toFixed(1) + "%",
      `  norm: "${m2}" vs "${m1}"`
    );
  }
}

test().catch(console.error);
