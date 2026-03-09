/**
 * Dump full Browse API response to see all available fields
 * Usage: npx tsx scripts/test-browse-full-response.ts
 */
import { getValidAccessToken } from "../src/lib/ebay/token";
import { prisma } from "../src/lib/db";

const EBAY_ACCOUNT_ID = "cmll8dvd90001prri3d0mvn6k";
const ITEM_ID = "236644903065"; // Lot of 24 TI-84 Plus CE Python

async function main() {
  const { token } = await getValidAccessToken(EBAY_ACCOUNT_ID);

  const url = `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${ITEM_ID}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });

  if (!res.ok) {
    console.error("Failed:", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();

  // Show all top-level keys and their types/sizes
  console.log("=== TOP-LEVEL KEYS ===\n");
  for (const [key, value] of Object.entries(data)) {
    const type = Array.isArray(value) ? `array[${(value as any[]).length}]` : typeof value;
    const preview = typeof value === "string"
      ? value.slice(0, 100)
      : typeof value === "object" && value !== null
        ? JSON.stringify(value).slice(0, 150)
        : String(value);
    console.log(`  ${key} (${type}): ${preview}`);
  }

  // Show interesting nested structures
  console.log("\n=== ITEM DETAILS ===\n");
  console.log("Title:", data.title);
  console.log("Price:", data.price);
  console.log("Condition:", data.condition);
  console.log("Condition ID:", data.conditionId);
  console.log("Condition Descriptors:", JSON.stringify(data.conditionDescriptors, null, 2));
  console.log("Category Path:", data.categoryPath);
  console.log("Category ID:", data.categoryId);
  console.log("Item Location:", data.itemLocation);
  console.log("Seller:", JSON.stringify(data.seller, null, 2));
  console.log("Return Terms:", JSON.stringify(data.returnTerms, null, 2));
  console.log("Shipping Options:", JSON.stringify(data.shippingOptions, null, 2));
  console.log("Ship To Locations:", JSON.stringify(data.shipToLocations, null, 2));
  console.log("Quantity:", data.quantity);
  console.log("Quantity Sold:", data.quantitySold);
  console.log("Quantity Available:", data.estimatedAvailabilities);
  console.log("Buying Options:", data.buyingOptions);
  console.log("Item Specifics:", JSON.stringify(data.localizedAspects, null, 2));
  console.log("Product:", JSON.stringify(data.product, null, 2));
  console.log("Image URLs:", data.image, data.additionalImages?.length, "additional");
  console.log("Item Web URL:", data.itemWebUrl);
  console.log("Description length:", data.description?.length, "chars");
  console.log("Short Description:", data.shortDescription);
  console.log("Item Creation Date:", data.itemCreationDate);
  console.log("Item End Date:", data.itemEndDate);
  console.log("Listing Market:", data.listingMarketplaceId);
  console.log("Top Rated Listing:", data.topRatedBuyingExperience);
  console.log("Priority Listing:", data.priorityListing);
  console.log("Enabled for Guest Checkout:", data.enabledForGuestCheckout);
  console.log("Tax:", JSON.stringify(data.tax, null, 2));
  console.log("Payment Methods:", JSON.stringify(data.paymentMethods, null, 2));
  console.log("Authenticity Guarantee:", data.authenticityGuarantee);
  console.log("Authenticity Verification:", data.authenticityVerification);
  console.log("Hazardous Materials:", data.hazardousMaterialsLabels);
  console.log("Eligible for Inline Checkout:", data.eligibleForInlineCheckout);
  console.log("Lot Size:", data.lotSize);
  console.log("Legacy Item ID:", data.legacyItemId);

  // Check total JSON size
  const fullJson = JSON.stringify(data);
  console.log("\n=== SIZE ===");
  console.log(`Full JSON: ${fullJson.length} chars (${(fullJson.length / 1024).toFixed(1)} KB)`);

  // Estimate storage for all listings
  const listingCount = await prisma.listings.count();
  console.log(`Current listings: ${listingCount}`);
  console.log(`Estimated storage if all enriched: ${((fullJson.length * listingCount) / 1024 / 1024).toFixed(1)} MB`);

  await prisma.$disconnect();
}

main().catch(console.error);
