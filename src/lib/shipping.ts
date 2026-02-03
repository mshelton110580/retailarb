export function deriveShippingStatus(input: {
  actualDelivery?: string | null;
  cancelStatus?: string | null;
  scheduledMax?: string | null;
  estimatedMax?: string | null;
  hasTracking: boolean;
  hasScheduledWindow: boolean;
  hasEstimatedWindow: boolean;
}) {
  if (input.actualDelivery) {
    return "delivered";
  }
  if (input.cancelStatus && input.cancelStatus.startsWith("Cancel")) {
    return "canceled";
  }
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
  if (input.hasTracking || input.hasScheduledWindow) {
    return "shipped";
  }
  if (input.hasEstimatedWindow) {
    return "pre_shipment";
  }
  return "unknown";
}
