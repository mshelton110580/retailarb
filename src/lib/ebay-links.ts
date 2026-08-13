// Shared eBay case-filing link builders.
// Given an order id and an item's { itemId, transactionId }, build a direct
// link into eBay's Return / Item-Not-Received flows. When the item (or its
// transactionId) is unavailable, fall back to the generic order page.

export type EbayLinkItem = { itemId: string; transactionId: string | null };

export function buildReturnUrl(orderId: string, item: EbayLinkItem | undefined): string {
  return item?.transactionId
    ? `https://www.ebay.com/rtn/Return/ReturnViewSelectedItem?itemId=${item.itemId}&transactionId=${item.transactionId}`
    : `https://order.ebay.com/ord/show?orderId=${orderId}`;
}

export function buildInrUrl(orderId: string, item: EbayLinkItem | undefined): string {
  return item?.transactionId
    ? `https://www.ebay.com/ItemNotReceived/CreateRequest?itemId=${item.itemId}&transactionId=${item.transactionId}`
    : `https://order.ebay.com/ord/show?orderId=${orderId}`;
}
