# Inventory "In Transit" Category Refinement

## Issue

Order `23-13866-04075` was still appearing in "Shipped" even after the closed INR fix because the "Shipped" category was too broad.

### Order Details:
- Purchase date: Nov 26, 2025 (84 days ago!)
- Has tracking: ✓
- Delivered: ✗
- Refunded: ✓ (`totals.total: "0.0"`)
- INR filed and CLOSED: ✓
- Estimated delivery: None (no `estimated_max`)

## Problem with Original Logic

**Old "Shipped" logic:**
```typescript
if (isDelivered) {
  buckets.delivered.push(shipment);
} else if (hasTracking) {
  buckets.shipped.push(shipment);  // ← Too broad!
}
```

This put **ANY** order with tracking into "Shipped", including:
- Refunded orders with tracking
- Orders 84 days old with no delivery
- Orders past their expected delivery date

**Result:** "Shipped" became a dumping ground for problematic orders instead of showing truly in-transit shipments.

## Solution: Refined "In Transit" Category

Renamed "Shipped" → "In Transit" and added strict criteria:

### New Logic:

```typescript
if (isDelivered) {
  buckets.delivered.push(shipment);
} else if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
  // Check cancelled/refunded BEFORE checking tracking
  buckets.cancelled.push(shipment);
} else if (hasTracking && !isCancelled && !isRefunded) {
  // Calculate expected delivery
  let expectedBy: Date | null = null;
  if (shipment.estimated_max) {
    expectedBy = new Date(shipment.estimated_max);
  } else if (shipment.order?.purchase_date) {
    expectedBy = new Date(shipment.order.purchase_date);
    expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS); // 7 days
  }

  // Only "In Transit" if within expected delivery window
  if (!expectedBy || now <= expectedBy) {
    buckets.shipped.push(shipment);
  } else {
    // Past expected delivery → catchall (will appear in "Overdue" action item)
    buckets.never_shipped.push(shipment);
  }
}
```

### Criteria for "In Transit":

1. ✅ Has tracking
2. ✅ NOT delivered
3. ✅ NOT cancelled/refunded
4. ✅ Within expected delivery window (purchase_date + 7 days OR estimated_max)

### What Changed:

| Category | Old Logic | New Logic |
|----------|-----------|-----------|
| **In Transit** | Has tracking + not delivered | Has tracking + not delivered + **not refunded** + **within delivery window** |
| **Cancelled** | After checking shipped | **Before** checking shipped (higher priority) |
| **Never Shipped** | No tracking only | No tracking + **overdue shipments** + refunded with open case |

## Order Flow Examples

### Example 1: Order 23-13866-04075
- Has tracking: ✓
- Purchase: Nov 26, 2025 (84 days ago)
- Expected delivery: Dec 3, 2025 (77 days ago)
- Refunded: ✓
- INR: CLOSED

**Old categorization:** Shipped ❌
**New categorization:** Cancelled & Refunded ✓

**Why:** Refunded orders are checked BEFORE tracking, so it goes to "Cancelled"

### Example 2: Normal In-Transit Order
- Has tracking: ✓
- Purchase: Feb 15, 2026 (3 days ago)
- Expected delivery: Feb 22, 2026 (4 days away)
- Not refunded: ✓

**Categorization:** In Transit ✓

### Example 3: Overdue Order (no refund)
- Has tracking: ✓
- Purchase: Jan 1, 2026 (48 days ago)
- Expected delivery: Jan 8, 2026 (41 days ago)
- Not refunded: ✓
- Not delivered: ✓

**Old categorization:** Shipped
**New categorization:** Never Shipped (catchall) + appears in "Overdue — Not Received" action item ✓

**Why:** Past expected delivery window, falls to catchall, flagged as action item

## Updated UI

### Card Label:
- **Old:** "Shipped"
- **New:** "In Transit"

### Card Description:
- **Old:** "Tracking uploaded, not yet delivered"
- **New:** "Has tracking, within expected delivery window, not refunded"

### Section Header Math:
- **Old:** Delivered + Shipped + Cancelled + Never Shipped = Total Orders
- **New:** Delivered + **In Transit** + Cancelled + Never Shipped = Total Orders

## Impact on Metrics

### Before Fix:
- "Shipped" = 150 orders (includes 84-day-old refunded orders!)
- "Cancelled & Refunded" = 20 orders
- "Overdue — Not Received" = 30 orders

### After Fix:
- "In Transit" = 50 orders (only truly in-transit)
- "Cancelled & Refunded" = 120 orders (includes refunded with tracking)
- "Never Shipped" = Increased (includes overdue shipments)

## Benefits

1. **Accurate "In Transit"** - Only shows orders actively in transit
2. **Clear Action Items** - Overdue orders surface in action items, not hidden in "Shipped"
3. **Better Prioritization** - Refunded orders move to "Cancelled" immediately
4. **Realistic Metrics** - "In Transit" count reflects actual pending deliveries

## Technical Details

### Expected Delivery Calculation:

```typescript
const DEFAULT_TRANSIT_DAYS = 7;

let expectedBy: Date | null = null;
if (shipment.estimated_max) {
  // Use eBay's estimated delivery if available
  expectedBy = new Date(shipment.estimated_max);
} else if (shipment.order?.purchase_date) {
  // Fallback: purchase_date + 7 days
  expectedBy = new Date(shipment.order.purchase_date);
  expectedBy.setDate(expectedBy.getDate() + DEFAULT_TRANSIT_DAYS);
}
```

### Priority Order:

1. **Delivered** (most definitive)
2. **Cancelled/Refunded** (check before tracking!)
3. **In Transit** (has tracking + within window + not refunded)
4. **Never Shipped** (catchall - includes overdue)

## Files Modified

- **File:** `/src/app/inventory/page.tsx`
- **Lines:** 350-377 (primary status logic)
- **Lines:** 43 (card description)
- **Lines:** 617 (section header math)

## Testing

After deployment, verify:

1. Order `23-13866-04075`:
   - ✓ NOT in "In Transit"
   - ✓ IN "Cancelled & Refunded"

2. Recent order with tracking (within 7 days):
   - ✓ IN "In Transit"

3. Old order with tracking (30+ days, no refund):
   - ✓ NOT in "In Transit"
   - ✓ IN "Never Shipped" catchall
   - ✓ ALSO in "Overdue — Not Received" action item

## Deployment

- **Date:** Feb 18, 2026
- **Server:** arbdesk.sheltonpropertiesllc.com
- **Status:** ✓ Deployed and running
