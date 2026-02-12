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
}) {
  // Delivered: has actual delivery time
  if (input.actualDelivery) {
    return "delivered";
  }
  // Canceled
  if (input.cancelStatus && input.cancelStatus.startsWith("Cancel")) {
    return "canceled";
  }
  // Check for late/not_delivered based on expected delivery window
  const expectedMax = input.scheduledMax ?? input.estimatedMax;
  if (expectedMax) {
    const expectedDate = new Date(expectedMax);
    const now = new Date();
    const lateCutoff = new Date(expectedDate);
    lateCutoff.setDate(lateCutoff.getDate() + 3);
    const notDeliveredCutoff = new Date(expectedDate);
    notDeliveredCutoff.setDate(notDeliveredCutoff.getDate() + 5);
    if (now > notDeliveredCutoff) {
      return "not_delivered";
    }
    if (now > lateCutoff) {
      return "late";
    }
  }
  // Shipped: has tracking number, shipped time, or scheduled delivery window
  if (input.hasTracking || input.shippedTime || input.hasScheduledWindow) {
    return "shipped";
  }
  // Pre-shipment: has estimated delivery window but no tracking yet
  if (input.hasEstimatedWindow) {
    return "pre_shipment";
  }
  // If order is Completed on eBay but we have no delivery info, assume delivered
  if (input.orderStatus === "Completed") {
    return "delivered";
  }
  return "pending";
}
