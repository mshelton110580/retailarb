import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ maxRetries: 5 });
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a product listing analyst. Given an eBay listing title and purchase quantity, determine if this is a lot (multiple physical items) and break down exactly what items are included.

Rules:
- "Lot of X" or "LOT X" or "X -" prefix means X physical items
- A title listing multiple model numbers (e.g., "TI-84 Plus, TI-83 Plus") means multiple distinct items
- "w/Cover", "w/Cable", "Charging Dock" are accessories, not separate items
- Purchase qty > 1 means the buyer bought multiple of whatever the listing describes
- If the title says "Lot of 6" and qty=2, that means 2 lots of 6 = 12 total items`;

const LOT_DETECTION_TOOL = {
  name: "detect_lot" as const,
  description: "Analyze a listing to detect if it contains multiple items (a lot)",
  input_schema: {
    type: "object" as const,
    properties: {
      isLot: {
        type: "boolean",
        description: "True if the listing contains multiple physical items"
      },
      totalItems: {
        type: "number",
        description: "Total number of physical items in one purchase unit (e.g., 'Lot of 4' = 4)"
      },
      itemBreakdown: {
        type: "array",
        description: "Breakdown of distinct items in the lot",
        items: {
          type: "object",
          properties: {
            product: { type: "string", description: "Standardized product name (e.g., TI-84 Plus CE Black)" },
            quantity: { type: "number", description: "How many of this specific item" }
          },
          required: ["product", "quantity"]
        }
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence in the lot detection"
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of how the lot was detected"
      }
    },
    required: ["isLot", "totalItems", "itemBreakdown", "confidence", "reasoning"] as string[]
  }
};

interface TestCase {
  title: string;
  qty: number;
  actualScanned: number;
  actualLotSize: number | null;
}

const testCases: TestCase[] = [
  { title: "Lot of 22 Texas Instruments Ti-83 Plus Graphing Calculators w/Covers Case Tested", qty: 1, actualScanned: 22, actualLotSize: 22 },
  { title: "*LOT OF 6* TI-84 Plus Silver Edition Graphing Texas Instruments Calculator", qty: 2, actualScanned: 12, actualLotSize: 6 },
  { title: "Lot of 12 Texas Instruments TI 83 PLUS calculator with Slide Covers", qty: 1, actualScanned: 12, actualLotSize: 12 },
  { title: "WORKING TI 83 PLUS calculator (lot of 10) Excellent Condition Clean Screens", qty: 1, actualScanned: 11, actualLotSize: 11 },
  { title: "TEXAS INSTRUMENTS - LOT 10 TI-84 PLUS CE  SCHOOL EDITION YELLOW - CHARGING DOCK", qty: 1, actualScanned: 10, actualLotSize: 10 },
  { title: "Texas Instruments TI-84 Plus CE  w/Charging Station  #0238", qty: 1, actualScanned: 10, actualLotSize: 10 },
  { title: "Texas Instruments TI-84 plus CE, TI-84 Plus, TI-83 Plus, TI30x IIS (DESCRIPTION)", qty: 1, actualScanned: 6, actualLotSize: 6 },
  { title: "Lot of 3 TI-83 Plus & 2 TI-84 Plus & 1 TI-84 Plus C Silver Calculators TESTED", qty: 1, actualScanned: 6, actualLotSize: 6 },
  { title: "5 - Texas Instruments TI-83 Plus & TI-83 + Silver Edition Graphing Calculators", qty: 1, actualScanned: 5, actualLotSize: 5 },
  { title: "Lot of 4 Texas Instruments 2 TI-84 Plus Calculators & 2 Silver Edition! Pink!!!", qty: 1, actualScanned: 4, actualLotSize: 4 },
  { title: "Lot of 3 Texas Instrument Calculators TI-83 Plus, TI-30X IIS, & TI-34 II Working", qty: 1, actualScanned: 3, actualLotSize: 3 },
  { title: "Texas Instruments TI-84 Plus CE Color Graphing Calculator - Teal Metallic", qty: 1, actualScanned: 3, actualLotSize: 3 },
  { title: "Texas Instruments TI-84 Plus Graphics Calculator - Black With Case Works.", qty: 1, actualScanned: 7, actualLotSize: 7 },
  // Non-lots for comparison
  { title: "Texas Instruments TI-84 Plus CE Graphing Calculator Black", qty: 1, actualScanned: 1, actualLotSize: null },
  { title: "Texas Instruments TI-83 Plus Graphing Calculator W/Cover Tested Works Great READ", qty: 1, actualScanned: 1, actualLotSize: null },
];

async function main() {
  console.log("Testing AI lot detection against actual scan data...\n");

  for (const tc of testCases) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Listing title: "${tc.title}"\nPurchase quantity: ${tc.qty}\n\nIs this a lot? How many physical items?`
        }],
        tools: [LOT_DETECTION_TOOL],
        tool_choice: { type: "tool", name: "detect_lot" }
      });

      const toolBlock = response.content.find(b => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        console.log(`ERROR: No tool response for "${tc.title}"`);
        continue;
      }

      const r = toolBlock.input as any;
      const aiTotal = r.isLot ? r.totalItems * tc.qty : tc.qty;
      const match = aiTotal === tc.actualScanned ? "MATCH" : aiTotal === (tc.actualLotSize ?? tc.actualScanned) ? "~MATCH" : "MISS";

      console.log(`Title:    ${tc.title}`);
      console.log(`Qty:      ${tc.qty} | Actual scanned: ${tc.actualScanned}`);
      console.log(`AI:       isLot=${r.isLot} | itemsPerUnit=${r.totalItems} | total=${aiTotal} [${match}] (${r.confidence})`);
      if (r.itemBreakdown?.length > 0) {
        console.log(`Breakdown:`);
        for (const item of r.itemBreakdown) {
          console.log(`          ${item.quantity}x ${item.product}`);
        }
      }
      console.log(`Reason:   ${r.reasoning}`);
      console.log("-".repeat(100));
    } catch (err: any) {
      console.log(`ERROR for "${tc.title}": ${err.message}`);
      console.log("-".repeat(100));
    }
  }
}

main().catch(console.error);
