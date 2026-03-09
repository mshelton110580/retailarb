/**
 * Test script: Fetch eBay listing via Browse API and test AI lot detection
 * with both title and description.
 *
 * Usage: npx tsx scripts/test-browse-description.ts
 */
import { getItemByLegacyId } from "../src/lib/ebay/browse";
import { getValidAccessToken } from "../src/lib/ebay/token";
import { prisma } from "../src/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const ITEM_ID = "197827493675"; // TI-84 Plus CE w/Charging Station
const EBAY_ACCOUNT_ID = "cmll8dvd90001prri3d0mvn6k";

async function main() {
  console.log("=== Step 1: Fetch item from eBay Browse API ===\n");

  const { token } = await getValidAccessToken(EBAY_ACCOUNT_ID);
  const item = await getItemByLegacyId(token, ITEM_ID);

  if (!item) {
    console.error("Failed to fetch item from eBay");
    process.exit(1);
  }

  console.log("Title:", item.title);
  console.log("Price:", item.price);
  console.log("GTIN:", item.gtin);
  console.log("Brand:", item.brand);

  const description = item.raw?.description ?? null;
  const shortDescription = item.raw?.shortDescription ?? null;

  console.log("\n--- Short Description ---");
  console.log(shortDescription ?? "(none)");

  console.log("\n--- Full Description (first 2000 chars) ---");
  if (description) {
    // Strip HTML tags for readability
    const textOnly = description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    console.log(textOnly.slice(0, 2000));
    console.log(`\n(Total length: ${description.length} chars, text-only: ${textOnly.length} chars)`);
  } else {
    console.log("(no description)");
  }

  console.log("\n\n=== Step 2: AI Lot Detection — Title Only ===\n");

  const client = new Anthropic();

  const titleOnlyResult = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `You are a product listing analyst. Given a listing title and optional description, determine if this is a LOT (multiple physical items) or a single item.

Rules:
- "Lot of X", "LOT X", "*LOT OF X*" means X physical items
- A number prefix like "5 - " or "4x" means that many items
- "w/Cover", "w/Cable", "w/Charging Station", "Dock" are accessories, NOT separate items
- Look for quantity indicators in the description like "includes X units", "set of X", item lists, etc.
- If the description lists individual serial numbers or units, count them

Return JSON: { "isLot": boolean, "itemsPerUnit": number, "confidence": "high"|"medium"|"low", "reasoning": string, "detectedItems": string[] }`,
    messages: [
      {
        role: "user",
        content: `Title: "${item.title}"\nPurchase quantity: 1\n\nAnalyze this listing. Is it a lot or single item?`
      }
    ]
  });

  const titleOnlyText = titleOnlyResult.content[0].type === "text" ? titleOnlyResult.content[0].text : "";
  console.log("Title-only result:");
  console.log(titleOnlyText);

  if (!description) {
    console.log("\nNo description available — skipping description-enhanced test");
    await prisma.$disconnect();
    return;
  }

  console.log("\n\n=== Step 3: AI Lot Detection — Title + Description ===\n");

  // Strip HTML but keep structure hints
  const cleanDesc = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|td|th)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Truncate to keep token usage reasonable
  const descForAI = cleanDesc.slice(0, 3000);

  console.log("Description text sent to AI (first 1000 chars):");
  console.log(descForAI.slice(0, 1000));
  console.log("...\n");

  const titleAndDescResult = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `You are a product listing analyst. Given a listing title and optional description, determine if this is a LOT (multiple physical items) or a single item.

Rules:
- "Lot of X", "LOT X", "*LOT OF X*" means X physical items
- A number prefix like "5 - " or "4x" means that many items
- "w/Cover", "w/Cable", "w/Charging Station", "Dock" are accessories, NOT separate items — UNLESS the description reveals the charging station comes WITH multiple units
- Look for quantity indicators in the description like "includes X units", "set of X", item lists, serial numbers, etc.
- If the description lists individual serial numbers or units, count them
- The description is more authoritative than the title — titles are often abbreviated or misleading

Return JSON: { "isLot": boolean, "itemsPerUnit": number, "confidence": "high"|"medium"|"low", "reasoning": string, "detectedItems": string[] }`,
    messages: [
      {
        role: "user",
        content: `Title: "${item.title}"\nPurchase quantity: 1\n\nListing description:\n${descForAI}\n\nAnalyze this listing. Is it a lot or single item?`
      }
    ]
  });

  const titleAndDescText = titleAndDescResult.content[0].type === "text" ? titleAndDescResult.content[0].text : "";
  console.log("Title + Description result:");
  console.log(titleAndDescText);

  console.log("\n\n=== Summary ===");
  console.log("Title alone → likely detects as single item with accessory");
  console.log("Title + Description → should detect the actual lot contents");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
