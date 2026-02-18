# Inventory Categorization Fix: Closed Returns/INR Cases

## Issue Found

Order `23-13866-04075` was miscategorized as "Shipped" when it should have been in "Cancelled & Refunded".

### Order Details:
- Has tracking: ✓ (USPS 9400108106244513809179)
- Delivered: ✗ (`delivered_at: null`)
- Fully refunded: ✓ (`totals.total: "0.0"`)
- INR inquiry: Filed and **CLOSED** (`ebay_status: "CLOSED"`, `escalated_to_case: false`)

### Problem:

The inventory categorization logic was treating **ALL** returns and INR cases the same way, regardless of whether they were open or closed.

**Current logic:**
```typescript
// Create sets of ALL order IDs with returns or INR cases (both open AND closed)
const orderIdsWithReturns = new Set(returns.map(r => r.order_id)...);
const orderIdsWithINR = new Set(inrCases.map(i => i.order_id)...);

// Only categorize as cancelled if NO return/INR exists
if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
  buckets.cancelled.push(shipment);
} else if (hasTracking) {
  buckets.shipped.push(shipment);  // ← Order 23-13866-04075 ended up here!
}
```

**Result:** Orders with **closed** returns/INR cases were excluded from "Cancelled" and went into "Shipped" instead.

## Understanding eBay Statuses

### INR Inquiry Statuses (from database):

| ebay_status | ebay_state | escalated_to_case | Meaning |
|-------------|------------|-------------------|---------|
| CLOSED | CLOSED | false | Inquiry resolved without case (refunded/resolved) |
| CLOSED | CLOSED | true | Inquiry closed after being escalated to case |
| CS_CLOSED | CS_CLOSED | true | Case closed by customer service |
| OTHER | OTHER | true | Other case statuses |

**Key insight:** `ebay_status: "CLOSED"` with `escalated_to_case: false` means:
- The INR inquiry was filed
- It was resolved/refunded
- **No case was ever opened**
- This is essentially complete/finished - not an active issue

### Return Statuses:

Closed return states:
- `ebay_state: "CLOSED"`
- `ebay_state: "RETURN_CLOSED"`
- `ebay_state: "REFUND_ISSUED"`
- `ebay_status: "CLOSED"`
- `ebay_status: "REFUND_ISSUED"`
- `ebay_status: "LESS_THAN_A_FULL_REFUND_ISSUED"`

## Solution

Filter the return/INR sets to **only include open cases**:

```typescript
// For returns: only include OPEN returns (exclude closed/refunded)
const orderIdsWithReturns = new Set(
  returns
    .filter((r) => {
      // Exclude closed returns
      if (r.ebay_state === "CLOSED" || r.ebay_state === "RETURN_CLOSED" || r.ebay_state === "REFUND_ISSUED") {
        return false;
      }
      if (r.ebay_status === "CLOSED" || r.ebay_status === "REFUND_ISSUED" || r.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED") {
        return false;
      }
      return true;
    })
    .map((r) => r.order_id)
    .filter((id): id is string => id !== null)
);

// For INR: only include OPEN cases (exclude closed)
const orderIdsWithINR = new Set(
  inrCases
    .filter((i) => i.ebay_status !== "CLOSED" && i.ebay_state !== "CLOSED")
    .map((i) => i.order_id)
    .filter((id): id is string => id !== null)
);
```

### How This Fixes Order 23-13866-04075:

**Before fix:**
1. Order is refunded (`totals.total: "0.0"`) ✓
2. Has INR case (`ebay_status: "CLOSED"`)
3. Check: `!orderIdsWithINR.has(orderId)` → **FALSE** (INR case exists)
4. Doesn't go into "Cancelled" bucket
5. Has tracking → goes into "Shipped" bucket ❌

**After fix:**
1. Order is refunded (`totals.total: "0.0"`) ✓
2. INR case is CLOSED → **excluded from `orderIdsWithINR` set**
3. Check: `!orderIdsWithINR.has(orderId)` → **TRUE** (no open INR case)
4. Goes into "Cancelled & Refunded" bucket ✓

## Additional Fix Required

Also updated the INR cases query to select the status fields:

```typescript
// Before:
prisma.inr_cases.findMany({
  ...
  select: { order_id: true },
});

// After:
prisma.inr_cases.findMany({
  ...
  select: {
    order_id: true,
    ebay_status: true,
    ebay_state: true
  },
});
```

## Impact

### Orders Now Correctly Categorized:

1. **Refunded with CLOSED INR inquiry** → "Cancelled & Refunded"
   - Example: 23-13866-04075
   - Has tracking but never delivered
   - INR filed and resolved with refund

2. **Refunded with CLOSED return** → "Cancelled & Refunded"
   - Return request filed, item returned, refund issued
   - All complete/closed

3. **Refunded with OPEN INR/return** → NOT in "Cancelled"
   - Still tracked in "Shipped" or "Delivered" buckets
   - Needs action - should appear in INR/Return tracking sections

### Categorization Logic Now:

```
Is Delivered? → Delivered
  ↓ NO
Has Tracking? → Shipped
  ↓ NO
Is Cancelled/Refunded AND no OPEN return/INR? → Cancelled & Refunded
  ↓ NO
→ Never Shipped (catchall)
```

## Files Modified

- **File:** `/src/app/inventory/page.tsx`
- **Lines:** 300-324 (returns/INR filtering)
- **Lines:** 171-173 (INR query select)

## Testing

After deployment, verify order `23-13866-04075` now appears in:
- ✓ "Cancelled & Refunded" bucket (not "Shipped")
- ✓ NOT in warehouse status (excluded from check-in tracking)

Other test cases:
1. Order with open INR → Should stay in "Shipped" (needs action)
2. Order with closed return → Should go to "Cancelled & Refunded"
3. Order with no tracking + closed INR → Should go to "Cancelled & Refunded"

## Deployment

- **Date:** Feb 17, 2026
- **Server:** arbdesk.sheltonpropertiesllc.com
- **Status:** ✓ Deployed and running
