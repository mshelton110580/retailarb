# Inventory Check-In Alignment Fix

## Problem

"Checked In" and "Not Checked In" counts were not aligning correctly because of inconsistent logic around cancelled/refunded orders.

### Root Cause

**95 orders were delivered AND cancelled/refunded**. These orders were:
1. Counted in "Delivered" (primary status) ✓
2. EXCLUDED from "Checked In"/"Not Checked In" (warehouse status) ✗
3. EXCLUDED from "Delivered but not checked in" (action item) ✗

This created a misalignment where delivered orders disappeared from warehouse tracking.

## Solution

### Fix 1: Updated `isTrulyCancelled` Definition

**Before:**
```typescript
const isTrulyCancelled = (isCancelled || isRefunded)
                          && !orderIdsWithReturns.has(orderId)
                          && !orderIdsWithINR.has(orderId);
```

**After:**
```typescript
const isTrulyCancelled = (isCancelled || isRefunded)
                          && !orderIdsWithReturns.has(orderId)
                          && !orderIdsWithINR.has(orderId)
                          && !isDelivered;  // NEW!
```

**Rationale:** If an order was delivered, the physical item exists and needs warehouse tracking, regardless of cancellation/refund status.

### Fix 2: Consistent Action Item Logic

**Before:**
```typescript
if (isDelivered && !isCheckedIn && !isCancelled) {
  buckets.delivered_not_checked_in.push(shipment);
}
```

**After:**
```typescript
if (isDelivered && !isCheckedIn && !isTrulyCancelled) {
  buckets.delivered_not_checked_in.push(shipment);
}
```

**Rationale:** Action items should use the same cancellation logic as warehouse status for consistency.

## Impact

### Before Fix

**Database counts:**
- Total shipments: 998
- Delivered: 957
- Delivered AND (cancelled OR refunded): 95
- Checked in: 13
- Not checked in: 854

**Math problem:**
- Checked In (13) + Not Checked In (854) = 867
- But Delivered = 957
- Missing: 957 - 867 = **90 delivered orders** not tracked in warehouse status

These 90+ orders were delivered but excluded from warehouse tracking because they were cancelled/refunded.

### After Fix

**Expected counts:**
- Total shipments: 998
- Truly Cancelled = (cancelled OR refunded) AND no open return AND no open INR AND NOT delivered
- Active Orders (need warehouse tracking) = 998 - Truly Cancelled
- Checked In + Not Checked In = Active Orders

**Truly Cancelled calculation:**
- 132 cancelled/refunded orders
- Minus 95 that were delivered = 37
- Minus 1 with open INR = 36
- **Truly Cancelled ≈ 36 orders**

**Expected warehouse status:**
- Active Orders = 998 - 36 = 962
- Checked In = 13
- Not Checked In = 962 - 13 = 949

## Logic Flow (After Fix)

For each shipment:

1. **Primary Status** (mutually exclusive):
   - IF delivered → "Delivered"
   - ELSE IF (cancelled/refunded AND no open cases) → "Cancelled & Refunded"
   - ELSE IF (has tracking AND not cancelled/refunded) → "In Transit" or "Never Shipped"
   - ELSE → "Never Shipped"

2. **Warehouse Status**:
   - IF truly cancelled → EXCLUDE
   - ELSE IF checked in → "Checked In"
   - ELSE → "Not Checked In"

3. **Where `isTrulyCancelled`** =
   - (cancelled OR refunded)
   - AND no open return case
   - AND no open INR case
   - AND **NOT delivered** ← KEY FIX

## Why This Makes Sense

**Delivered orders should always be tracked in warehouse status because:**

1. **Physical inventory exists:** If eBay confirms delivery, the package was physically delivered
2. **May need to be returned:** Even cancelled/refunded orders might need return processing
3. **Warehouse accountability:** Need to track if item was checked in or lost
4. **Return processing:** Items may need to be returned to seller or disposed of

**Only truly cancelled orders should be excluded:**
- Order cancelled BEFORE delivery
- Never shipped
- No physical item to track

## Files Modified

- `/src/app/inventory/page.tsx`
  - Line 411: Added `&& !isDelivered` to `isTrulyCancelled` definition
  - Line 437: Changed `!isCancelled` to `!isTrulyCancelled` for consistency

## Testing

After deployment, verify:

```sql
-- Should return consistent counts
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL) as checked_in,
  COUNT(*) FILTER (WHERE checked_in_at IS NULL) as not_checked_in,
  COUNT(*) FILTER (WHERE
    (order_status = 'Cancelled' OR CAST((totals->>'total') AS NUMERIC) = 0)
    AND order_id NOT IN (SELECT order_id FROM returns WHERE ebay_state NOT IN ('CLOSED', 'RETURN_CLOSED', 'REFUND_ISSUED'))
    AND order_id NOT IN (SELECT order_id FROM inr_cases WHERE ebay_status != 'CLOSED')
    AND delivered_at IS NULL
  ) as truly_cancelled
FROM shipments s
LEFT JOIN orders o ON s.order_id = o.order_id;
```

Expected: `checked_in + not_checked_in + truly_cancelled = total`

## Deployment

1. Build and deploy updated code
2. Verify counts align on inventory page
3. Delivered orders should appear in warehouse status
4. "Checked In" + "Not Checked In" should account for nearly all non-cancelled orders
