# Category Aliases System

## Problem Statement

You want to keep automatically detected category name variations (aliases) so that when they appear again, they're automatically assigned to the correct parent category — **without** cluttering your database with hundreds of duplicate category records.

## Solution: Merge Mappings as Aliases

Instead of keeping duplicate category records, we use the **`category_merges` table** to store aliases. This table maps detected category names to their canonical category ID.

## How It Works

### 1. During Scanning (New Items)

When scanning a new item:

```typescript
// System generates category name from title
const categoryName = "TI 83 PLUS"  // detected from "Texas Instruments TI-83 Plus"

// Check if this name has a merge mapping (alias)
SELECT to_category_id FROM category_merges
WHERE LOWER(TRIM(from_category_name)) = 'ti 83 plus'

// If mapping exists → use that category automatically (no prompt)
// If no mapping → prompt user to create new or merge with existing
```

### 2. When Merging Duplicate Categories

When you merge duplicates in the admin panel:

```typescript
// Before: You have these duplicate categories in the database
"TI 83 PLUS" (15 units)     ← Keep this
"Ti 83 Plus" (0 units)      ← Will be deleted
"ti 83 plus" (3 units)      ← Will be deleted

// Action: Click "Quick Merge"

// After merge:
1. All 18 units → "TI 83 PLUS" category
2. Duplicate categories deleted from item_categories table
3. Merge mappings created in category_merges table:
   - "Ti 83 Plus" → TI 83 PLUS (category_id)
   - "ti 83 plus" → TI 83 PLUS (category_id)
```

### 3. Future Scans (Automatic Detection)

When the same variations appear again:

```typescript
// New scan detects: "ti 83 plus"
// System checks category_merges table
// Finds mapping: "ti 83 plus" → TI 83 PLUS (ID: abc123)
// Automatically assigns to "TI 83 PLUS" category
// NO user prompt needed!
```

## Benefits

### ✅ Clean Database
- Only ONE category record per product type
- No duplicate "TI 83 PLUS", "Ti 83 Plus", "ti 83 plus" entries
- Easy to browse and manage

### ✅ Automatic Detection
- System learns from your merge decisions
- Same variations auto-detect in the future
- No need to manually select category again

### ✅ Scalable
- Supports unlimited aliases per category
- Efficient lookups (indexed on from_category_name)
- Easy to add new aliases

### ✅ Maintainable
- View all aliases in Admin → Categories → Merge Mappings section
- Delete outdated mappings if needed
- No orphaned duplicate categories

## Database Schema

### category_merges Table

```sql
CREATE TABLE "category_merges" (
    "id" TEXT PRIMARY KEY,
    "from_category_name" TEXT NOT NULL UNIQUE,  -- The alias/variation
    "to_category_id" TEXT NOT NULL,             -- Points to canonical category
    "created_at" TIMESTAMP DEFAULT NOW(),
    "created_by" TEXT,

    FOREIGN KEY (to_category_id) REFERENCES item_categories(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ON category_merges(from_category_name);  -- Fast lookups
CREATE INDEX ON category_merges(to_category_id);              -- Fast reverse lookups
```

### Key Points

- **from_category_name** is UNIQUE - each alias can only point to one category
- **ON DELETE CASCADE** - if the target category is deleted, the mapping is removed
- **Case-insensitive matching** - uses `LOWER(TRIM(from_category_name))` for lookups

## Example Workflow

### Initial State
```
item_categories:
  - "TI 83 PLUS" (id: cat-001)
  - "Ti 83 Plus" (id: cat-002)
  - "ti 83 plus" (id: cat-003)

category_merges:
  (empty)
```

### After Quick Merge
```
item_categories:
  - "TI 83 PLUS" (id: cat-001)  ← All units here

category_merges:
  - "Ti 83 Plus" → cat-001
  - "ti 83 plus" → cat-001
```

### Future Scan: "TI-83+ Calculator"
```
1. System generates: "TI 83 CALCULATOR"
2. Check category_merges: no mapping found
3. Prompt user: create new or merge with existing
4. User selects: merge with "TI 83 PLUS"
5. New mapping created: "TI 83 CALCULATOR" → cat-001
```

### Future Scan: "Texas Instruments TI 83+ Used"
```
1. System generates: "TI 83 CALCULATOR"
2. Check category_merges: FOUND! → cat-001
3. Auto-assign to "TI 83 PLUS"
4. No prompt needed ✓
```

## Implementation Details

### When Merge Mappings Are Created

1. **During Scanning** (user-initiated):
   - User scans item with new category name
   - System prompts for category selection
   - User selects existing category from dropdown
   - Merge mapping created: detected_name → selected_category

2. **During Admin Merge** (bulk cleanup):
   - Admin merges duplicate categories
   - For each deleted duplicate:
     - Merge mapping created: duplicate_name → target_category
   - Also redirects any existing mappings that pointed to the deleted category

### When Mappings Are Used

Every scan, before prompting the user:
```typescript
const detectedName = generateCategoryName(title);
const mapping = await checkMergeMapping(detectedName);

if (mapping) {
  // Auto-assign, no prompt
  return { categoryId: mapping.to_category_id, requiresManualSelection: false };
} else {
  // Prompt user
  return { categoryId: null, requiresManualSelection: true };
}
```

## Viewing and Managing Aliases

### Admin Panel: /admin/categories

**Merge Mappings Section** shows:
- All alias → category mappings
- When each was created
- Delete button for each mapping

**Example Display:**
```
"ti 83 plus" → TI 83 PLUS         (Jan 15, 2026)  [Delete]
"TI-83+ Calc" → TI 83 PLUS        (Jan 16, 2026)  [Delete]
"HP 50G GRAPHING" → HP 50G        (Jan 18, 2026)  [Delete]
```

### Deleting Mappings

If you delete a merge mapping:
- Future scans with that name will prompt again
- No effect on existing units (they keep their category)
- Useful if the mapping was incorrect

## Edge Cases Handled

### 1. Merging Category A → B, when A already has mappings

**Before:**
```
category_merges:
  "variation 1" → Category A
  "variation 2" → Category A
```

**Merge A → B:**
```
category_merges:
  "variation 1" → Category B  (redirected)
  "variation 2" → Category B  (redirected)
  "Category A"  → Category B  (new)
```

All aliases now point to the new target.

### 2. Circular mappings prevented

The UNIQUE constraint on `from_category_name` prevents:
- Multiple mappings for the same alias
- Chains like: A → B → C

If you need to change a mapping, the `ON CONFLICT` clause updates it:
```sql
INSERT INTO category_merges (from_category_name, to_category_id, ...)
VALUES ('ti 83 plus', 'new-category-id', ...)
ON CONFLICT (from_category_name)
DO UPDATE SET to_category_id = 'new-category-id'
```

### 3. Category deletion cascades

If you delete a category that has aliases pointing to it:
- `ON DELETE CASCADE` automatically removes those mappings
- No orphaned mappings left behind

## Best Practices

### 1. Merge Duplicates Early
- Use Admin → Categories to identify and merge duplicates
- The more you merge early, the fewer prompts you'll see

### 2. Trust the System
- Once you've merged duplicates, the system learns
- Same variations won't prompt you again

### 3. Review Mappings Periodically
- Check Admin → Categories → Merge Mappings
- Delete any incorrect mappings
- Ensure aliases point to the right categories

### 4. Standardize Category Names
- When merging, choose the most descriptive name as the target
- Example: Keep "TI-83 Plus Graphing Calculator" over "TI 83 PLUS"

## Future Enhancements

Potential improvements:
1. **Fuzzy matching** - suggest similar categories when creating new ones
2. **Bulk import** - upload CSV of aliases → categories
3. **Alias analytics** - show which aliases are most frequently detected
4. **Category hierarchy** - parent/child categories with inheritance
5. **GTIN-based matching** - prefer GTIN matches over name matching

## Summary

The category aliases system provides:
- ✅ **Clean database** - no duplicate category records
- ✅ **Smart detection** - system learns from your decisions
- ✅ **Minimal prompts** - only asks once per unique variation
- ✅ **Easy management** - view and delete aliases in admin panel
- ✅ **Automatic application** - future scans use mappings transparently

By using the `category_merges` table as an alias registry, you get all the benefits of automatic category detection without the clutter of duplicate category records.
