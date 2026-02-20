// Default number of days after purchase to consider an order overdue if no tracking
const DEFAULT_EXPECTED_TRANSIT_DAYS = 7;
// When an order has tracking but no delivery window, consider it overdue after this many days from shipment/purchase
const DEFAULT_TRACKED_OVERDUE_DAYS = 21;

export function deriveShippingStatus(input: {
  actualDelivery?: string | null;
  cancelStatus?: string | null;
  scheduledMax?: string | null;
  estimatedMax?: string | null;
  hasTracking: boolean;
  hasScheduledWindow: boolean;
  hasEstimatedWindow: boolean;
  shippedTime?: string | null;
  orderStatus?: string | null;
  purchaseDate?: string | null;
}) {
  const now = new Date();

  // Delivered: has actual delivery time
  if (input.actualDelivery) {
    return "delivered";
  }
  // Canceled
  if (input.cancelStatus && input.cancelStatus.startsWith("Cancel")) {
    return "canceled";
  }

  // Determine the expected delivery deadline
  const expectedMax = input.scheduledMax ?? input.estimatedMax;
  let expectedDate: Date | null = null;
  if (expectedMax) {
    expectedDate = new Date(expectedMax);
  } else if (input.purchaseDate) {
    // Fallback: purchase date + default transit days
    expectedDate = new Date(input.purchaseDate);
    expectedDate.setDate(expectedDate.getDate() + DEFAULT_EXPECTED_TRANSIT_DAYS);
  }

  // If we have tracking, check late/not_delivered based on expected date.
  // If no delivery window was provided by eBay, fall back to shipped/purchase date + overdue threshold
  // so orders with tracking but no EDD don't stay stuck at "shipped" forever.
  if (input.hasTracking) {
    const trackingExpected = expectedDate ?? (() => {
      const base = input.shippedTime
        ? new Date(input.shippedTime)
        : input.purchaseDate
          ? new Date(input.purchaseDate)
          : null;
      if (!base) return null;
      const d = new Date(base);
      d.setDate(d.getDate() + DEFAULT_TRACKED_OVERDUE_DAYS);
      return d;
    })();

    if (trackingExpected) {
      const lateCutoff = new Date(trackingExpected);
      lateCutoff.setDate(lateCutoff.getDate() + 3);
      const notDeliveredCutoff = new Date(trackingExpected);
      notDeliveredCutoff.setDate(notDeliveredCutoff.getDate() + 5);
      if (now > notDeliveredCutoff) {
        return "not_delivered";
      }
      if (now > lateCutoff) {
        return "late";
      }
    }
    return "shipped";
  }

  // No tracking: check if past expected date — item was never shipped
  if (!input.hasTracking && !input.shippedTime) {
    if (expectedDate && now > expectedDate) {
      return "not_received";
    }
  }

  // Shipped time but no tracking
  if (input.shippedTime || input.hasScheduledWindow) {
    return "shipped";
  }
  // Pre-shipment: has estimated delivery window but no tracking yet
  if (input.hasEstimatedWindow) {
    return "pre_shipment";
  }
  // If order is Completed on eBay and has tracking, assume delivered
  if (input.orderStatus === "Completed" && input.hasTracking) {
    return "delivered";
  }
  return "pending";
}
