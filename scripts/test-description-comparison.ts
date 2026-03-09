/**
 * Test: Compare AI lot detection with title-only vs title+description
 * for multiple listings.
 *
 * Usage: npx tsx scripts/test-description-comparison.ts
 */
import { getItemByLegacyId } from "../src/lib/ebay/browse";
import { getValidAccessToken } from "../src/lib/ebay/token";
import { prisma } from "../src/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const EBAY_ACCOUNT_ID = "cmll8dvd90001prri3d0mvn6k";

const TEST_ITEMS = [
  // Ambiguous title — "w/Charging Station" looks like accessory but is actually lot of 10
  { itemId: "197827493675", title: "Texas Instruments TI-84 Plus CE  w/Charging Station  #0238", knownLotSize: 10 },
  // Another charging dock listing — lot of 10+1?
  { itemId: "187764170249", title: "TEXAS INSTRUMENTS - LOT 10 TI-84 PLUS CE  SCHOOL EDITION YELLOW - CHARGING DOCK", knownLotSize: 11 },
  // Clear lot title
  { itemId: "236644903065", title: "Texas Instruments TI-84 Plus CE Python Graphing Calculators Lot of 24", knownLotSize: 24 },
  // "Qty 6" prefix — clear in title
  { itemId: "267513129405", title: "Qty 6 - Texas Instruments TI-84 Plus Silver Edition Graphing Calculators Lot B", knownLotSize: 6 },
  // Mixed lot — title says "Lot of 3 TI-83 Plus & 2 TI-84 Plus & 1 TI-84 Plus C Silver"
  { itemId: "177590237441", title: "Lot of 3 TI-83 Plus & 2 TI-84 Plus & 1 TI-84 Plus C Silver Calculators TESTED", knownLotSize: 6 },
  // High price single — $525 Richmar ComboCare, NOT a lot
  { itemId: "136897698383", title: "EXCELLENT CONDITION Richmar ComboCare Electrotherapy and Ultrasound Combo Unit", knownLotSize: 1 },
  // "Lot of 22" clear in title
  { itemId: "177489187786", title: "Lot of 22 Texas Instruments Ti-83 Plus Graphing Calculators w/Covers Case Tested", knownLotSize: 22 },
  // "TI-84PLUS Quantity Of 3" — slightly unusual format
  { itemId: "397353686810", title: "TI-84PLUS Quantity Of 3", knownLotSize: 3 },
];

const SYSTEM_PROMPT = `You are a product listing analyst. Given a listing title and optional description, determine if this is a LOT (multiple physical items) or a single item.

Rules:
- "Lot of X", "LOT X", "*LOT OF X*", "Qty X", "Quantity of X" means X physical items
- A number prefix like "5 - " or "4x" means that many items
- "w/Cover", "w/Cable", "w/Charging Station", "Dock" are typically accessories, NOT separate items — UNLESS the description reveals the charging station comes WITH multiple units
- Look for quantity indicators in the description like "includes X units", "set of X", item lists, serial numbers, etc.
- If the description lists individual serial numbers or units, count them
- The description is more authoritative than the title — titles are often abbreviated or misleading
- A charging station/dock with calculators may indicate a classroom set (lot)

Return JSON only: { "isLot": boolean, "itemsPerUnit": number, "confidence": "high"|"medium"|"low", "reasoning": string }`;

function cleanHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|td|th)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const { token } = await getValidAccessToken(EBAY_ACCOUNT_ID);
  const client = new Anthropic();

  console.log("Fetching listings from eBay...\n");

  // Fetch all items first
  const items: Array<{
    itemId: string;
    title: string;
    knownLotSize: number;
    description: string | null;
    fetchError: boolean;
  }> = [];

  for (const test of TEST_ITEMS) {
    try {
      const item = await getItemByLegacyId(token, test.itemId);
      const desc = item?.raw?.description ? cleanHtml(item.raw.description) : null;
      items.push({
        itemId: test.itemId,
        title: test.title,
        knownLotSize: test.knownLotSize,
        description: desc,
        fetchError: !item,
      });
      console.log(`  ✓ ${test.itemId} — ${desc ? `${desc.length} chars description` : "no description"}`);
    } catch (err: any) {
      console.log(`  ✗ ${test.itemId} — fetch failed: ${err.message?.slice(0, 80)}`);
      items.push({
        itemId: test.itemId,
        title: test.title,
        knownLotSize: test.knownLotSize,
        description: null,
        fetchError: true,
      });
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("COMPARISON: Title-Only vs Title+Description");
  console.log("=".repeat(100));

  for (const item of items) {
    console.log(`\n${"─".repeat(100)}`);
    console.log(`Item: ${item.itemId}`);
    console.log(`Title: ${item.title}`);
    console.log(`Known lot size: ${item.knownLotSize}`);
    if (item.description) {
      console.log(`Description preview: ${item.description.slice(0, 150)}...`);
    }

    // Title-only
    const titleResult = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Title: "${item.title}"\nPurchase quantity: 1\n\nIs this a lot or single item? Return JSON only.`
      }]
    });
    const titleText = titleResult.content[0].type === "text" ? titleResult.content[0].text : "";
    const titleJson = parseJson(titleText);
    const titleTokens = titleResult.usage;

    // Title + Description (if available)
    let descJson: any = null;
    let descTokens: any = null;
    if (item.description) {
      const descResult = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Title: "${item.title}"\nPurchase quantity: 1\n\nListing description:\n${item.description.slice(0, 3000)}\n\nIs this a lot or single item? Return JSON only.`
        }]
      });
      const descText = descResult.content[0].type === "text" ? descResult.content[0].text : "";
      descJson = parseJson(descText);
      descTokens = descResult.usage;
    }

    // Display comparison
    const titleCorrect = titleJson?.itemsPerUnit === item.knownLotSize;
    const descCorrect = descJson?.itemsPerUnit === item.knownLotSize;

    console.log(`\n  TITLE ONLY:       isLot=${titleJson?.isLot}, items=${titleJson?.itemsPerUnit}, conf=${titleJson?.confidence}  ${titleCorrect ? "✅ CORRECT" : "❌ WRONG"}`);
    console.log(`    Tokens: ${titleTokens.input_tokens} in / ${titleTokens.output_tokens} out — Cost: $${((titleTokens.input_tokens * 0.8 + titleTokens.output_tokens * 4) / 1000000).toFixed(6)}`);
    console.log(`    Reasoning: ${titleJson?.reasoning?.slice(0, 120)}`);

    if (descJson) {
      console.log(`  TITLE+DESC:       isLot=${descJson.isLot}, items=${descJson.itemsPerUnit}, conf=${descJson.confidence}  ${descCorrect ? "✅ CORRECT" : "❌ WRONG"}`);
      console.log(`    Tokens: ${descTokens.input_tokens} in / ${descTokens.output_tokens} out — Cost: $${((descTokens.input_tokens * 0.8 + descTokens.output_tokens * 4) / 1000000).toFixed(6)}`);
      console.log(`    Reasoning: ${descJson.reasoning?.slice(0, 120)}`);
      if (!titleCorrect && descCorrect) {
        console.log(`    🔑 DESCRIPTION MADE THE DIFFERENCE`);
      }
    } else {
      console.log(`  TITLE+DESC:       (no description available${item.fetchError ? " — fetch failed" : ""})`);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(100)}`);
  console.log("SUMMARY");
  console.log("=".repeat(100));
  let titleCorrectCount = 0, descCorrectCount = 0, descMadeDifference = 0, totalWithDesc = 0;
  for (const item of items) {
    // Re-parse would be needed but let's just count from the flow above
  }
  console.log("(See individual results above)");

  await prisma.$disconnect();
}

function parseJson(text: string): any {
  try {
    // Extract JSON from possible markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    return JSON.parse(match[1]!.trim());
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
