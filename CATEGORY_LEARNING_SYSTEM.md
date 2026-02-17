# Category Learning System

## Overview

The category learning system enables the application to improve category detection accuracy over time by learning from user decisions. When a new category name is detected during scanning, the system prompts the user to either create it as a new category or merge it with an existing one. Future scans with the same category name automatically apply the stored merge mapping.

## How It Works

### 1. First Scan with New Category

When scanning an item with a category name the system hasn't seen before:

1. **Detection**: The system generates a category name from the item title (e.g., "TI 83 PLUS" from "Texas Instruments TI-83 Plus Calculator")
2. **Merge Check**: Checks the `category_merges` table for any existing merge mapping
3. **User Prompt**: If no mapping exists, shows a blocking modal with:
   - The suggested category name prominently displayed
   - Option to **create new category** with the suggested name
   - Dropdown to **merge with existing category** (auto-creates mapping)
   - Skip/defer option

### 2. User Selection

**Option A: Create New Category**
- Clicks the green "Create New Category" button
- System creates the category in `item_categories` table
- Assigns the new category to the scanned unit
- No merge mapping created (this IS the canonical category)

**Option B: Merge with Existing Category**
- Selects an existing category from the dropdown
- System creates a merge mapping: `fromCategoryName → selectedCategoryId`
- Assigns the selected category to the unit
- Shows confirmation: "Category merged... Future scans will auto-merge."

### 3. Future Scans

When the same category name appears again:
- System checks `category_merges` table first
- Finds the stored mapping
- Automatically applies the merged category
- No user prompt needed
- **The system learns!**

## Database Schema

### `category_merges` Table

```sql
CREATE TABLE "category_merges" (
    "id" TEXT NOT NULL,
    "from_category_name" TEXT NOT NULL,
    "to_category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    CONSTRAINT "category_merges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_merges_from_category_name_key"
ON "category_merges"("from_category_name");

CREATE INDEX "category_merges_to_category_id_idx"
ON "category_merges"("to_category_id");
```

**Key Fields:**
- `from_category_name`: The detected category name (e.g., "TI 83 PLUS")
- `to_category_id`: The actual category ID to use
- `created_by`: User who created the mapping

**Constraints:**
- Unique constraint on `from_category_name` ensures one mapping per detected name
- Foreign key to `item_categories(id)` with CASCADE delete
- `ON CONFLICT` clause allows updates to existing mappings

## API Endpoints

### POST /api/categories/merge

Create or update a category merge mapping.

**Request:**
```json
{
  "fromCategoryName": "TI 83 PLUS",
  "toCategoryId": "uuid-of-existing-category"
}
```

**Response:**
```json
{
  "ok": true,
  "merge": { "id": "..." },
  "message": "\"TI 83 PLUS\" will now be merged into \"TI-83 Plus Graphing Calculator\""
}
```

**Auth Required:** ADMIN or RECEIVER role

### POST /api/categories

Create a new category.

**Request:**
```json
{
  "name": "TI 83 PLUS"
}
```

**Response:**
```json
{
  "category": { "id": "...", "category_name": "TI 83 PLUS" },
  "message": "Category \"TI 83 PLUS\" created successfully"
}
```

**Special Behavior:**
- Returns 409 Conflict if category already exists (case-insensitive check)
- Includes the existing category in the response on conflict

**Auth Required:** ADMIN or RECEIVER role

## Code Changes

### 1. `src/lib/item-categorization.ts`

**Updated `findOrCreateCategory()` function:**

```typescript
// Step 1: Check for merge mapping first
const categoryName = generateCategoryName(title);
const normalizedName = categoryName.toLowerCase().trim();

const existingMerge = await prisma.$queryRawUnsafe(
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

// Step 2: Check exact name match (prevents duplicates)
const exactMatch = await prisma.$queryRawUnsafe(
  `SELECT id FROM item_categories WHERE LOWER(TRIM(category_name)) = $1 LIMIT 1`,
  normalizedName
);

if (exactMatch && exactMatch.length > 0) {
  return {
    categoryId: exactMatch[0].id,
    confidence: "high",
    requiresManualSelection: false
  };
}

// Step 3: No match found - ALWAYS prompt for new categories
return {
  categoryId: null,
  confidence: "low",
  requiresManualSelection: true,
  reason: `New category "${categoryName}" - select existing to merge or confirm new`,
  suggestedCategoryName: categoryName
};
```

**Key Changes:**
- Merge checking happens FIRST (highest priority)
- Exact name matching prevents duplicates
- ALWAYS prompts for truly new categories
- Returns `suggestedCategoryName` for UI display

### 2. `src/app/receiving/receiving-form.tsx`

**Updated Modal UI:**

```tsx
{pendingCategorySelection.suggestedCategoryName && (
  <div className="mt-3 rounded-lg bg-blue-900/30 border border-blue-800 p-3">
    <p className="text-sm font-medium text-blue-300">
      System detected: <span className="font-bold">
        {pendingCategorySelection.suggestedCategoryName}
      </span>
    </p>
  </div>
)}

{/* Big green button to create new category */}
<button onClick={() => handleCreateNewCategory(unitId, suggestedName)}>
  ✓ Create New Category: "{suggestedCategoryName}"
</button>

{/* Dropdown to merge with existing */}
<select onChange={(e) => handleCategorySelection(unitId, e.target.value, suggestedName)}>
  <option value="">-- Select Existing Category to Merge --</option>
  {categories.map(cat => <option value={cat.id}>{cat.category_name}</option>)}
</select>
```

**New Functions:**

- `handleCreateNewCategory()`: Calls POST /api/categories, then assigns to unit
- `handleCategorySelection()`: Enhanced to optionally create merge mapping

## Example Workflow

### Scenario: Scanning TI-83 Calculators from Different Orders

**First Scan (Order A - "TI-83 Plus Graphing Calculator")**
1. System detects category: "TI 83 PLUS"
2. No merge mapping exists
3. Modal shows: "System detected: **TI 83 PLUS**"
4. User clicks "Create New Category: TI 83 PLUS"
5. Category created in database
6. Unit assigned to new category

**Second Scan (Order B - "Texas Instruments TI-83 Plus Calculator")**
1. System detects category: "TI 83 PLUS" (same normalized name!)
2. Exact match found → Auto-assigned
3. No prompt shown

**Third Scan (Order C - "TI 83+ Calculator (Used)")**
1. System detects category: "TI 83 CALCULATOR" (slightly different)
2. No merge mapping exists
3. Modal shows: "System detected: **TI 83 CALCULATOR**"
4. User selects existing "TI 83 PLUS" from dropdown
5. System creates merge: "TI 83 CALCULATOR" → "TI 83 PLUS" category ID
6. Unit assigned to "TI 83 PLUS" category
7. Message: "Category merged... Future scans will auto-merge."

**Fourth Scan (Order D - "TI 83+ Calculator")**
1. System detects category: "TI 83 CALCULATOR"
2. Merge mapping found! ("TI 83 CALCULATOR" → "TI 83 PLUS")
3. **Automatically applies "TI 83 PLUS" category**
4. No prompt shown
5. **System learned from user's previous decision!**

## Benefits

1. **Reduces Duplicate Categories**: Prevents "TI 83 PLUS", "TI 83 Plus", "TI-83 Plus" from being separate categories
2. **Learns Over Time**: Each merge decision improves future accuracy
3. **User Control**: Users decide canonical category names
4. **Transparent**: Clear feedback when merges are applied
5. **Non-Destructive**: Merge mappings can be edited/deleted without affecting actual categories
6. **Scalable**: Works efficiently even with thousands of merge mappings

## Migration Script

Run once to create the table:

```bash
npx tsx scripts/add-category-merges-table.ts
```

## Testing

Test the complete workflow:

1. Scan an item with a new category name
2. Verify modal appears with suggested name
3. Test creating new category
4. Scan another item that should merge
5. Select existing category from dropdown
6. Verify merge mapping created
7. Scan third item with same detected category
8. Verify automatic merge (no prompt)

## Future Enhancements

Potential improvements:

1. **Merge Management UI**: Admin page to view/edit/delete merge mappings
2. **Bulk Merges**: Apply merge to all existing units with a category name
3. **Fuzzy Matching**: Suggest similar categories when creating merge
4. **Merge Analytics**: Track which categories are most frequently merged
5. **Merge History**: Audit trail of merge mapping changes
6. **Category Aliases**: Multiple names pointing to same category
7. **Import/Export**: Share merge mappings across instances

## Troubleshooting

**Modal doesn't appear:**
- Check browser console for errors
- Verify `requiresManualSelection: true` in API response
- Check `suggestedCategoryName` is populated

**Merge not working:**
- Check `category_merges` table for mapping
- Verify case-insensitive matching with `LOWER(TRIM(...))`
- Check foreign key constraint (category must exist)

**Duplicates still appearing:**
- Check exact name matching in `findOrCreateCategory()`
- Verify deduplication in GET /api/categories
- Look for typos in merge mappings

## Related Files

- `src/lib/item-categorization.ts` - Category detection logic
- `src/app/api/categories/route.ts` - List/create categories
- `src/app/api/categories/merge/route.ts` - Create merge mappings
- `src/app/api/receiving/scan/route.ts` - Scanning workflow
- `src/app/receiving/receiving-form.tsx` - UI modal
- `scripts/add-category-merges-table.ts` - Migration script
- `prisma/migrations/20260217_add_category_merges/migration.sql` - Schema
