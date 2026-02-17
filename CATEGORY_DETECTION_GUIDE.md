# Category Detection & Mixed Lot Handling

## Problem
Order `06-14029-36812` contains a lot with 2 different calculator models:
- **TI-84 Plus**
- **TI-83 Plus**

But both units were categorized as "TI-84 Plus" because the system extracted only the first model from the title: "Texas Instruments TI-84 Plus & TI-83 Plus Graphing Calculator w/ Five Star Cases"

## Solution

### Smart Detection with Conditional Manual Selection

The system now uses **intelligent detection** to determine when manual category selection is needed.

### When Manual Selection is REQUIRED:

1. **Multiple Products Detected** - Title contains multiple distinct model numbers
   - Example: "TI-84 Plus & TI-83 Plus" (2 models detected)
   - Triggers: `&`, `and`, `+`, `with` separators with different models on each side
   - Also: "lot of", "bundle of", "set of" language

2. **Low Confidence Match** - No GTIN and <70% similarity to existing categories
   - Example: Generic title like "Calculator" with no model/brand

3. **No Meaningful Product Info** - Title is unclear or too generic
   - Example: "Electronics Item"

### When Auto-Categorization is USED:

1. **High Confidence (≥90% similarity)** - Auto-assigns to best match
   - Example: "TI-84 Plus CE Pink" matches existing "TI-84 Plus CE" category at 95%

2. **GTIN Exact Match** - Always uses existing category with matching GTIN
   - Example: UPC 029806139510 → TI-84 Plus Silver Edition

3. **Medium Confidence (70-89% similarity)** - Auto-assigns but logs for review
   - Example: "Texas Instruments TI-84 Plus" matches "TI-84 Plus" at 85%

4. **New with Strong Product Info** - Auto-creates if model + brand detected
   - Example: "Sony WH-1000XM4 Black" → Creates new "WH-1000XM4 Black" category

## API Endpoints

### Get All Categories
```
GET /api/categories

Response:
{
  "categories": [
    {
      "id": "...",
      "category_name": "TI-84 Plus",
      "gtin": null,
      "category_keywords": ["graphing calculator", "texas instruments", "ti-84 plus"]
    },
    ...
  ]
}
```

### Create New Category
```
POST /api/categories/create

Body:
{
  "categoryName": "TI-83 Plus",
  "gtin": "029806139510" // optional
}

Response:
{
  "ok": true,
  "category": { ... }
}
```

### Update Unit Category (Post-Scan Recategorization)
```
PATCH /api/receiving/unit/[unitId]/category

Body:
{
  "categoryId": "cmxxxx..." // or null to remove category
}

Response:
{
  "ok": true,
  "unit": {
    "id": "...",
    "category_id": "...",
    "category": {
      "id": "...",
      "category_name": "TI-83 Plus"
    }
  }
}
```

## Scan Response Format

The scan API now returns category information:

```json
{
  "scan": { ... },
  "resolution": "MATCHED",
  "results": [
    {
      "orderId": "06-14029-36812",
      "unitIndex": 1,
      "unitId": "cmxxxx...",
      "categoryInfo": {
        "categoryId": "cmxxxx...",
        "confidence": "low",
        "requiresManualSelection": true,
        "reason": "Multiple products detected in title"
      },
      "item": {
        "title": "Texas Instruments TI-84 Plus & TI-83 Plus..."
      }
    }
  ]
}
```

## UI Implementation (Next Steps)

To fully support mixed lots, the receiving UI should:

1. **During Scan** - When `requiresManualSelection: true`:
   - Show category selection dropdown
   - List all existing categories + "Create New" option
   - Allow user to select correct category for this specific unit

2. **Post-Scan Recategorization** - On the receiving/scan list page:
   - Add "Edit Category" button next to each unit
   - Show current category with option to change
   - Fetch categories via `GET /api/categories`
   - Update via `PATCH /api/receiving/unit/[unitId]/category`

3. **Lot Detection Warning** - When `isLot: true`:
   - Show warning: "Lot detected - multiple items in single listing"
   - Prompt: "Does each unit have a different product? Select category for each."

## Example: Fixing Order 06-14029-36812

Current state:
- Unit 1: TI-84 Plus (good) → **CORRECT**
- Unit 2: TI-84 Plus (damaged) → **WRONG - should be TI-83 Plus**

To fix:
```bash
# Get the unit ID for unit 2
curl https://arbdesk.sheltonpropertiesllc.com/api/receiving/scan/[scan_id]

# Get TI-83 Plus category ID (or create it)
curl https://arbdesk.sheltonpropertiesllc.com/api/categories

# Update unit 2's category
curl -X PATCH https://arbdesk.sheltonpropertiesllc.com/api/receiving/unit/[unitId]/category \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "[ti-83-plus-category-id]"}'
```

## Detection Logic Details

### Multiple Product Detection
```typescript
// Checks for patterns like:
- "TI-84 & TI-83" (different models with separator)
- "Lot of 10 Calculators"
- "Bundle of TI-84 Plus and TI-83 Plus"
- "Xbox Series X + PS5" (2 different consoles)
```

### Confidence Scoring
- **Color mismatch**: 0% (different colors = different products)
- **Full model match**: 35% of score
- **Brand match**: 20% of score
- **Product type match**: 15% of score
- **Color match**: 30% of score

Examples:
- "TI-84 Plus CE Pink" vs "TI-84 Plus CE Pink" → 100% (exact)
- "TI-84 Plus CE" vs "TI-84 Plus" → 70% (base model match)
- "TI-84 Plus Pink" vs "TI-84 Plus Blue" → 0% (color mismatch)

## Benefits

1. **Prevents Mixed Lot Errors** - Detects when manual input is needed
2. **Maintains High Accuracy** - Auto-categorizes only when confident
3. **Flexible Recategorization** - Fix mistakes after scanning
4. **Scales Well** - No UI changes required for simple cases
5. **Audit Trail** - Logs confidence levels and reasons

## Testing

Test the detection with order `06-14029-36812`:
```bash
ssh arbdesk "cd /opt/retailarb && npx tsx scripts/check-mixed-lot.ts"
```

This shows:
- Both units currently categorized as "TI-84 Plus"
- Title contains both "TI-84 Plus" and "TI-83 Plus"
- Detection should flag `requiresManualSelection: true`
