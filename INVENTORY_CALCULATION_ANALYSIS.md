# Inventory Page Calculation Analysis

## Issue Found

The inventory page has a categorization logic issue where some shipments may not be counted in the primary delivery status buckets.

### Current Logic (Lines 350-374)

```typescript
// PRIMARY STATUS (should be mutually exclusive)
if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
  buckets.cancelled.push(shipment);
} else if (isDelivered) {
  buckets.delivered.push(shipment);
} else if (hasTracking) {
  buckets.shipped.push(shipment);
}

// ACTION ITEMS
if (!hasTracking && !isDelivered && !isCancelled && !isRefunded && !orderIdsWithINR.has(orderId)) {
  buckets.never_shipped.push(shipment);
}
```

### Problem Cases

**Case 1: INR Filed + No Tracking**
- Order has INR case filed
- No tracking uploaded
- Not delivered
- Not cancelled/refunded

**Current behavior:**
- Excluded from `cancelled` (because has INR case)
- Not in `delivered` (not delivered)
- Not in `shipped` (no tracking)
- Not in `never_shipped` (because has INR case - line 372)

**Result:** This shipment is NOT counted in Delivered, Shipped, Cancelled, OR Never Shipped!

**Case 2: Return Filed + Not Cancelled + No Tracking + Not Delivered**
- Order has return filed
- No tracking uploaded (seller never shipped or forgot to upload)
- Not delivered
- Not cancelled/refunded

**Current behavior:**
- Excluded from `cancelled` (because has return case)
- Not in `delivered` (not delivered)
- Not in `shipped` (no tracking)
- Excluded from `never_shipped` (no explicit check, but likely affected)

**Result:** Also not counted properly in primary status!

## Expected Math

The page states:
```
Delivered + Shipped + Cancelled + Never Shipped = Total Orders
```

But with the current logic, this equation will NOT hold true when:
1. Orders with INR cases but no tracking exist
2. Orders with returns filed but no tracking exist

## Fix Required

The primary status categorization needs to be **truly mutually exclusive** and **exhaustive** (every shipment must fall into exactly one category).

### Proposed Fix

```typescript
// PRIMARY STATUS (mutually exclusive and exhaustive)
if (isDelivered) {
  buckets.delivered.push(shipment);
} else if (hasTracking) {
  buckets.shipped.push(shipment);
} else if ((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId)) {
  buckets.cancelled.push(shipment);
} else {
  // Everything else = never shipped (no tracking, not delivered, not cancelled without case)
  // This includes:
  // - True never shipped (seller forgot)
  // - Orders with INR filed (because they weren't shipped!)
  // - Orders with returns filed but never shipped (rare edge case)
  buckets.never_shipped.push(shipment);
}
```

**Rationale:**
1. Check delivered FIRST (most definitive)
2. Check tracking SECOND (in transit)
3. Check cancelled THIRD (only if no return/INR - those are already handled elsewhere)
4. Everything else = NEVER SHIPPED (catchall to ensure exhaustiveness)

This ensures: **Delivered + Shipped + Cancelled + Never Shipped = Total Orders** ✓

## Additional Issues to Check

### Warehouse Status Math

The page states:
```
Checked In + Not Checked In = Total Orders (excluding cancelled)
```

Current logic (lines 361-367):
```typescript
if (!isCancelled) {
  if (isCheckedIn) {
    buckets.checked_in.push(shipment);
  } else {
    buckets.not_checked_in.push(shipment);
  }
}
```

**Issue:** This only checks `isCancelled` but not `isRefunded`!

If an order is refunded but not marked as cancelled, it will be counted in warehouse status.

**Fix:**
```typescript
if (!isCancelled && !isRefunded) {
  if (isCheckedIn) {
    buckets.checked_in.push(shipment);
  } else {
    buckets.not_checked_in.push(shipment);
  }
}
```

Or more accurately:
```typescript
// Only count warehouse status for non-cancelled orders (including those with returns/INR)
const shouldCountWarehouseStatus = !((isCancelled || isRefunded) && !orderIdsWithReturns.has(orderId) && !orderIdsWithINR.has(orderId));

if (shouldCountWarehouseStatus) {
  if (isCheckedIn) {
    buckets.checked_in.push(shipment);
  } else {
    buckets.not_checked_in.push(shipment);
  }
}
```

This ensures orders with returns/INR are INCLUDED in warehouse status (because they need to be checked in and returned).

## Testing Plan

1. Create test order with INR filed, no tracking → should appear in "Never Shipped"
2. Create test order with return filed, no tracking → should appear in "Never Shipped"
3. Verify: Delivered + Shipped + Cancelled + Never Shipped = Total Orders
4. Verify: Checked In + Not Checked In = Total Orders - Cancelled (without returns/INR)
5. Verify: Orders with returns/INR are included in warehouse status even if "cancelled"
