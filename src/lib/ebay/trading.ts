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
    const transactions = safeArray(order.TransactionArray?.Transaction).map((transaction: any) => ({
      itemId: transaction?.Item?.ItemID ?? "",
      title: transaction?.Item?.Title ?? "",
      quantity: Number(transaction?.QuantityPurchased ?? 0),
      transactionPrice: transaction?.TransactionPrice?.value ?? "0",
      shippingServiceCost: transaction?.ShippingServiceSelected?.ShippingServiceCost?.value
    }));

    const shipments = safeArray(order?.ShippingDetails?.ShipmentTrackingDetails).map((detail: any) => ({
      carrier: detail?.ShippingCarrierUsed,
      trackingNumber: detail?.ShipmentTrackingNumber,
      statusText: detail?.ShipmentTrackingDetails?.Status
    }));

    return {
      orderId: order?.OrderID ?? "",
      createdTime: order?.CreatedTime ?? "",
      orderStatus: order?.OrderStatus ?? "",
      total: order?.Total?.value ?? "0",
      shippingAddress: {
        city: order?.ShippingAddress?.CityName,
        state: order?.ShippingAddress?.StateOrProvince,
        postalCode: order?.ShippingAddress?.PostalCode
      },
      transactions,
      shipments,
      delivery: {
        estimatedMin: order?.ShippingDetails?.ShippingServiceSelected?.EstimatedDeliveryTimeMin,
        estimatedMax: order?.ShippingDetails?.ShippingServiceSelected?.EstimatedDeliveryTimeMax,
        scheduledMin: order?.ShippingDetails?.ShippingPackageInfo?.ScheduledDeliveryTimeMin,
        scheduledMax: order?.ShippingDetails?.ShippingPackageInfo?.ScheduledDeliveryTimeMax,
        actualDelivery: order?.ShippingDetails?.ShippingPackageInfo?.ActualDeliveryTime
      }
    };
  });

  return { raw: data, orders };
}
