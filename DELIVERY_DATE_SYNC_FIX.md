# Delivery Date Sync Fix

## Issue

Order `12-14204-47439` shows as "Delivered on Tue, Feb 17" on eBay but the database has `delivered_at: null`, causing it to incorrectly appear in "Overdue — Not Received" instead of "Delivered".

## Root Cause

eBay's Trading API `GetOrders` call was not returning delivery dates for orders where delivery was confirmed through tracking updates or INR case investigations.

The original code only checked for `ActualDeliveryTime` in the `ShippingPackageInfo` structure:

```typescript
// Old code - only checked ShippingPackageInfo
const packageInfos = safeArray(svcSelected?.ShippingPackageInfo);
for (const pkg of packageInfos) {
  if (pkg?.ActualDeliveryTime && !actualDelivery) {
    actualDelivery = String(pkg.ActualDeliveryTime);
  }
}
```

**Problem:** When eBay confirms delivery through tracking or INR investigations, they don't always populate `ShippingPackageInfo.ActualDeliveryTime`. Instead, they populate `ShipmentTrackingDetails.DeliveryDate` or `ShipmentTrackingDetails.DeliveryTime`.

## Solution

Updated `/src/lib/ebay/trading.ts` to check for delivery information in the tracking details:

### Changes Made:

**1. Capture delivery fields from tracking details (lines 78-82, 97-101):**

```typescript
const txTracking = safeArray(transaction?.ShippingDetails?.ShipmentTrackingDetails).map((detail: any) => ({
  carrier: detail?.ShippingCarrierUsed ? String(detail.ShippingCarrierUsed) : undefined,
  trackingNumber: detail?.ShipmentTrackingNumber ? String(detail.ShipmentTrackingNumber) : undefined,
  deliveryDate: detail?.DeliveryDate ? String(detail.DeliveryDate) : undefined,  // NEW
  deliveryTime: detail?.DeliveryTime ? String(detail.DeliveryTime) : undefined   // NEW
}));
```

**2. Add fallback to check tracking for delivery (lines 137-151):**

```typescript
// Additional fallback: check tracking details for delivery date/time
if (!actualDelivery) {
  for (const t of [...allTrackingDetails, ...orderLevelTracking]) {
    if (t.deliveryTime) {
      actualDelivery = t.deliveryTime;
      break;
    }
    if (t.deliveryDate) {
      actualDelivery = t.deliveryDate;
      break;
    }
  }
}
```

### Delivery Date Priority Order:

1. **First:** Check `ShippingPackageInfo.ActualDeliveryTime` (eBay's primary field)
2. **Second:** Check `ShippingDetails.ShippingPackageInfo.ActualDeliveryTime` (order-level fallback)
3. **Third (NEW):** Check `ShipmentTrackingDetails.DeliveryTime` (tracking-based delivery)
4. **Fourth (NEW):** Check `ShipmentTrackingDetails.DeliveryDate` (tracking-based delivery)

This ensures we capture delivery information regardless of how eBay confirms it.

## Testing

After deployment, you can test by:

1. **Run order sync** from the admin UI
2. Check that order `12-14204-47439` now has `delivered_at` populated
3. Verify it moves from "Overdue — Not Received" to "Delivered"

## Expected Result

When the order sync runs, it will now successfully retrieve the delivery date from eBay's tracking details and populate `delivered_at` in the database, causing the order to be correctly categorized as "Delivered".

## Files Modified

- **File:** `/src/lib/ebay/trading.ts`
- **Lines 75:** Updated type definition for tracking details array
- **Lines 78-82:** Added `deliveryDate` and `deliveryTime` extraction from transaction-level tracking
- **Lines 97-101:** Added `deliveryDate` and `deliveryTime` extraction from order-level tracking
- **Lines 137-151:** Added fallback logic to check tracking details for delivery information

## Deployment Status

- **Date:** Feb 18, 2026
- **Server:** arbdesk.sheltonpropertiesllc.com
- **Build:** ✓ Complete
- **Status:** ✓ Running

## Next Steps

1. Run order sync from the admin UI
2. Verify order 12-14204-47439 is now correctly categorized
3. Monitor for any other orders that may benefit from this fix
