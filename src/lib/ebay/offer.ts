const offerEndpoint = "https://api.ebay.com/buy/offer/v1/bid_proxy";

export async function placeProxyBid(token: string, itemId: string, maxBid: string) {
  const response = await fetch(offerEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      itemId,
      maxAmount: {
        currency: "USD",
        value: maxBid
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return { success: false, message: text };
  }

  const data = await response.json();
  return { success: true, data };
}
