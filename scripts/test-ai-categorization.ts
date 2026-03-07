/**
 * Test script: compare AI product parsing vs current DB categories
 * Usage: cd /opt/retailarb-dev && npx ts-node --project tsconfig.worker.json -r tsconfig-paths/register scripts/test-ai-categorization.ts
 */
import { extractProductInfo } from "@/lib/ai";

const titles = [
  "Lot Of 4 Damaged Texas Instruments TI-84 Plus Graphing Calculators - Black",
  "Texas Instruments TI-83 Plus Graphing Calculator W/Cover Tested Works Great READ",
  "Texas Instruments Ti 83 Plus",
  "Texas Instruments TI-84 Plus CE Graphing Calculator Color Pink - Tested/Working",
  "TEXAS INSTRUMENT TI-83 PLUS Graphing Calculator w/ Cover Tested Working",
  "Texas Instruments TI-84 Plus CE Graphing Calculator Black",
  "Texas Instruments TI 84 Plus Graphing Calculator Yellow Cover",
  "Texas Instruments TI-83 Plus, Graphing Scientific Calculator, Black w/cover",
  "Texas Instruments TI-84 Plus Ce Graphing Calculator with Cover+Cord Yellow/Black",
  "Lot of 12 Texas Instruments TI 83 PLUS calculator with Slide Covers",
  "Texas Instruments TI 84 plus CE Graphing Calculator Docking Station 10 ports NEW",
  "Texas Instruments TI-84 Plus CE Color Graphing Calculator White W/Cover #1",
  "Texas Instruments TI-84 Plus Graphing Calculator - Black Lot Of 3 Tested Working",
];

const currentCategories: Record<string, string> = {
  "Lot Of 4 Damaged Texas Instruments TI-84 Plus Graphing Calculators - Black": "TI-84 Plus Black",
  "Texas Instruments TI-83 Plus Graphing Calculator W/Cover Tested Works Great READ": "TI-83 Plus",
  "Texas Instruments Ti 83 Plus": "TI-83 Plus",
  "Texas Instruments TI-84 Plus CE Graphing Calculator Color Pink - Tested/Working": "TI-84 Plus CE Pink",
  "TEXAS INSTRUMENT TI-83 PLUS Graphing Calculator w/ Cover Tested Working": "TI-83 Plus",
  "Texas Instruments TI-84 Plus CE Graphing Calculator Black": "TI-84 Plus CE Black",
  "Texas Instruments TI 84 Plus Graphing Calculator Yellow Cover": "TI 84 Plus Yellow",
  "Texas Instruments TI-83 Plus, Graphing Scientific Calculator, Black w/cover": "TI-83 Plus",
  "Texas Instruments TI-84 Plus Ce Graphing Calculator with Cover+Cord Yellow/Black": "(none)",
  "Lot of 12 Texas Instruments TI 83 PLUS calculator with Slide Covers": "TI 83 PLUS",
  "Texas Instruments TI 84 plus CE Graphing Calculator Docking Station 10 ports NEW": "Charging Station",
  "Texas Instruments TI-84 Plus CE Color Graphing Calculator White W/Cover #1": "TI-84 Plus CE White",
  "Texas Instruments TI-84 Plus Graphing Calculator - Black Lot Of 3 Tested Working": "TI-84 Plus Black",
};

async function main() {
  console.log("Testing AI product parsing against current DB categories...\n");
  console.log("=".repeat(120));

  for (const title of titles) {
    try {
      const info = await extractProductInfo(title);
      const current = currentCategories[title] || "(none)";
      const match = info.canonicalName === current ? "MATCH" : "DIFF";

      console.log(`\nTitle:    ${title}`);
      console.log(`Current:  ${current}`);
      console.log(`AI:       ${info.canonicalName}  [${match}]`);
      console.log(`Details:  brand=${info.brand || "-"} | line=${info.productLine || "-"} | model=${info.model || "-"} | color=${info.color || "-"} | type=${info.productType || "-"}`);
      console.log("-".repeat(120));
    } catch (err: any) {
      console.log(`\nTitle:    ${title}`);
      console.log(`ERROR:    ${err.message}`);
      console.log("-".repeat(120));
    }
  }
}

main().catch(console.error);
