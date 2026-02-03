const browseEndpoint = "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id";

export type BrowseItem = {
  itemId: string;
  title: string;
  price: string;
  endTime?: string;
  buyingOptions?: string[];
  shippingCost?: string;
  raw: unknown;
};

export async function getItemByLegacyId(token: string, itemId: string): Promise<BrowseItem | null> {
  const url = `${browseEndpoint}?legacy_item_id=${itemId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return {
    itemId: data?.legacyItemId ?? itemId,
    title: data?.title ?? "",
    price: data?.price?.value ?? "0",
    endTime: data?.itemEndDate,
    buyingOptions: data?.buyingOptions ?? [],
    shippingCost: data?.shippingOptions?.[0]?.shippingCost?.value,
    raw: data
  };
}
