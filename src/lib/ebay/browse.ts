const browseEndpoint = "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id";

export type BrowseItem = {
  itemId: string;
  title: string;
  price: string;
  endTime?: string;
  buyingOptions?: string[];
  shippingCost?: string;
  gtin?: string;
  brand?: string;
  mpn?: string;
  raw: any;
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

  // Extract GTIN from product data (UPC, EAN, ISBN)
  let gtin = data?.product?.gtin ??
             data?.product?.upc ??
             data?.product?.ean ??
             data?.product?.isbn ??
             null;

  // Standardize GTIN to 14 digits by left-padding with zeros
  // UPC = 12 digits, EAN = 13 digits, GTIN-14 = 14 digits
  if (gtin && gtin.length < 14) {
    gtin = gtin.padStart(14, '0');
  }

  return {
    itemId: data?.legacyItemId ?? itemId,
    title: data?.title ?? "",
    price: data?.price?.value ?? "0",
    endTime: data?.itemEndDate,
    buyingOptions: data?.buyingOptions ?? [],
    shippingCost: data?.shippingOptions?.[0]?.shippingCost?.value,
    gtin: gtin,
    brand: data?.product?.brand ?? null,
    mpn: data?.product?.mpn ?? null,
    raw: data
  };
}
