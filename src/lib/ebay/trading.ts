import { XMLParser } from "fast-xml-parser";

const tradingEndpoint = "https://api.ebay.com/ws/api.dll";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseTagValue: true,
  parseAttributeValue: true
});

export type GetOrdersResult = {
  raw: unknown;
  orders: Array<{
    orderId: string;
    createdTime: string;
    orderStatus: string;
    total: string;
    shippingAddress?: {
      city?: string;
      state?: string;
      postalCode?: string;
    };
    transactions: Array<{
      itemId: string;
      title: string;
      quantity: number;
      transactionPrice: string;
      shippingServiceCost?: string;
    }>;
    shipments: Array<{
      carrier?: string;
      trackingNumber?: string;
      statusText?: string;
    }>;
    delivery: {
      estimatedMin?: string;
      estimatedMax?: string;
      scheduledMin?: string;
      scheduledMax?: string;
      actualDelivery?: string;
    };
    shippedTime?: string;
    paidTime?: string;
  }>;
};

function buildHeaders(callName: string, token: string) {
  return {
    "Content-Type": "text/xml",
    "X-EBAY-API-CALL-NAME": callName,
    "X-EBAY-API-SITEID": "0",
    "X-EBAY-API-COMPATIBILITY-LEVEL": "1415",
    "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID ?? "",
    "X-EBAY-API-IAF-TOKEN": token
  };
}

function safeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractValue(obj: any): string | undefined {
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj === "object" && "value" in obj) return String(obj.value);
  if (typeof obj === "object" && "#text" in obj) return String(obj["#text"]);
  return String(obj);
}

export async function getOrders(token: string, sinceIso: string, untilIso: string): Promise<GetOrdersResult> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
  <GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <OrderRole>Buyer</OrderRole>
    <OrderStatus>All</OrderStatus>
    <CreateTimeFrom>${sinceIso}</CreateTimeFrom>
    <CreateTimeTo>${untilIso}</CreateTimeTo>
    <DetailLevel>ReturnAll</DetailLevel>
  </GetOrdersRequest>`;

  const response = await fetch(tradingEndpoint, {
    method: "POST",
    headers: buildHeaders("GetOrders", token),
    body
  });

  const xml = await response.text();
  const data = parser.parse(xml);
  const ordersRaw = data?.GetOrdersResponse?.OrderArray?.Order;
  const orders = safeArray(ordersRaw).map((order: any) => {
    // Collect all tracking details from TRANSACTION level (where eBay puts them)
    const allTrackingDetails: Array<{ carrier?: string; trackingNumber?: string }> = [];

    const transactions = safeArray(order.TransactionArray?.Transaction).map((transaction: any) => {
      const txTracking = safeArray(transaction?.ShippingDetails?.ShipmentTrackingDetails).map((detail: any) => ({
        carrier: detail?.ShippingCarrierUsed ? String(detail.ShippingCarrierUsed) : undefined,
        trackingNumber: detail?.ShipmentTrackingNumber ? String(detail.ShipmentTrackingNumber) : undefined
      }));
      allTrackingDetails.push(...txTracking);

      return {
        itemId: transaction?.Item?.ItemID ?? "",
        title: transaction?.Item?.Title ?? "",
        quantity: Number(transaction?.QuantityPurchased ?? 0),
        transactionPrice: extractValue(transaction?.TransactionPrice) ?? "0",
        shippingServiceCost: extractValue(transaction?.ShippingServiceSelected?.ShippingServiceCost)
      };
    });

    // Also check order-level ShippingDetails for tracking (fallback)
    const orderLevelTracking = safeArray(order?.ShippingDetails?.ShipmentTrackingDetails).map((detail: any) => ({
      carrier: detail?.ShippingCarrierUsed ? String(detail.ShippingCarrierUsed) : undefined,
      trackingNumber: detail?.ShipmentTrackingNumber ? String(detail.ShipmentTrackingNumber) : undefined
    }));

    // Merge and deduplicate tracking numbers
    const seenTracking = new Set<string>();
    const shipments: Array<{ carrier?: string; trackingNumber?: string; statusText?: string }> = [];
    for (const t of [...allTrackingDetails, ...orderLevelTracking]) {
      if (t.trackingNumber && !seenTracking.has(t.trackingNumber)) {
        seenTracking.add(t.trackingNumber);
        shipments.push({ carrier: t.carrier, trackingNumber: t.trackingNumber, statusText: undefined });
      }
    }

    // Delivery info from Order > ShippingServiceSelected > ShippingPackageInfo
    const svcSelected = order?.ShippingServiceSelected;
    const packageInfos = safeArray(svcSelected?.ShippingPackageInfo);

    let actualDelivery: string | undefined;
    let estimatedMin: string | undefined;
    let estimatedMax: string | undefined;
    let scheduledMin: string | undefined;
    let scheduledMax: string | undefined;

    for (const pkg of packageInfos) {
      if (pkg?.ActualDeliveryTime && !actualDelivery) actualDelivery = String(pkg.ActualDeliveryTime);
      if (pkg?.EstimatedDeliveryTimeMin && !estimatedMin) estimatedMin = String(pkg.EstimatedDeliveryTimeMin);
      if (pkg?.EstimatedDeliveryTimeMax && !estimatedMax) estimatedMax = String(pkg.EstimatedDeliveryTimeMax);
      if (pkg?.ScheduledDeliveryTimeMin && !scheduledMin) scheduledMin = String(pkg.ScheduledDeliveryTimeMin);
      if (pkg?.ScheduledDeliveryTimeMax && !scheduledMax) scheduledMax = String(pkg.ScheduledDeliveryTimeMax);
    }

    // Fallback: check ShippingDetails level
    if (!actualDelivery) {
      const fallbackPkg = order?.ShippingDetails?.ShippingPackageInfo;
      if (fallbackPkg?.ActualDeliveryTime) actualDelivery = String(fallbackPkg.ActualDeliveryTime);
    }

    return {
      orderId: order?.OrderID ?? "",
      createdTime: order?.CreatedTime ?? "",
      orderStatus: order?.OrderStatus ?? "",
      total: extractValue(order?.Total) ?? "0",
      shippingAddress: {
        city: order?.ShippingAddress?.CityName,
        state: order?.ShippingAddress?.StateOrProvince,
        postalCode: order?.ShippingAddress?.PostalCode
      },
      transactions,
      shipments,
      delivery: {
        estimatedMin,
        estimatedMax,
        scheduledMin,
        scheduledMax,
        actualDelivery
      },
      shippedTime: order?.ShippedTime ? String(order.ShippedTime) : undefined,
      paidTime: order?.PaidTime ? String(order.PaidTime) : undefined
    };
  });

  return { raw: data, orders };
}
