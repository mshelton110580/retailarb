/**
 * eBay Post-Order API v2 client
 * Handles Search Returns, Search Inquiries, and Search Cases
 * Base URL: https://api.ebay.com/post-order/v2/
 * Auth: OAuth user token with IAF prefix
 */

const POST_ORDER_BASE = "https://api.ebay.com/post-order/v2";

function buildHeaders(token: string) {
  return {
    Authorization: `IAF ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
  };
}

// ============================================================
// RETURN TYPES (matching actual API response structure)
// ============================================================

export type EbayReturnSummary = {
  returnId: string;
  orderId?: string;
  buyerLoginName?: string;
  sellerLoginName?: string;
  currentType?: string;
  state?: string;
  status?: string;
  creationInfo?: {
    item?: {
      itemId?: string;
      transactionId?: string;
      returnQuantity?: number;
    };
    type?: string;
    reason?: string;
    reasonType?: string;
    comments?: {
      content?: string;
    };
    creationDate?: {
      value?: string;
    };
  };
  sellerTotalRefund?: {
    estimatedRefundAmount?: { value: number; currency: string };
    actualRefundAmount?: { value: number; currency: string };
  };
  buyerTotalRefund?: {
    estimatedRefundAmount?: { value: number; currency: string };
    actualRefundAmount?: { value: number; currency: string };
  };
  sellerResponseDue?: {
    activityDue?: string;
    respondByDate?: { value?: string };
  };
  buyerResponseDue?: {
    activityDue?: string;
    respondByDate?: { value?: string };
  };
  escalationInfo?: {
    buyerEscalationEligibilityInfo?: { eligible?: boolean };
    sellerEscalationEligibilityInfo?: { eligible?: boolean };
  };
  sellerAvailableOptions?: Array<{ actionType?: string; actionURL?: string }>;
  buyerAvailableOptions?: Array<{ actionType?: string; actionURL?: string }>;
};

export type SearchReturnsResponse = {
  members: EbayReturnSummary[];
  total?: number;
  paginationOutput: {
    totalEntries: number;
    totalPages: number;
    offset: number;
    limit: number;
  };
};

export type EbayInquirySummary = {
  inquiryId: string;
  inquiryStatusEnum?: string;
  itemId?: string;
  transactionId?: string;
  buyer?: string;
  seller?: string;
  creationDate?: {
    value?: string;
    formattedValue?: string;
  };
  lastModifiedDate?: {
    value?: string;
    formattedValue?: string;
  };
  respondByDate?: {
    value?: string;
    formattedValue?: string;
  };
  claimAmount?: {
    value: number;
    currency: string;
  };
  escalationInfo?: {
    escalateStatus?: string;
    caseId?: string;
  };
};

export type SearchInquiriesResponse = {
  members: EbayInquirySummary[];
  paginationOutput: {
    totalEntries: number;
    totalPages: number;
    offset: number;
    limit: number;
  };
};

// ============================================================
// SEARCH RETURNS
// ============================================================

export async function searchReturns(
  token: string,
  options: {
    dateFrom?: string;
    dateTo?: string;
    returnState?: string;
    limit?: number;
    offset?: number;
    role?: string;
  } = {}
): Promise<SearchReturnsResponse> {
  const params = new URLSearchParams();

  if (options.dateFrom) params.set("creation_date_range_from", options.dateFrom);
  if (options.dateTo) params.set("creation_date_range_to", options.dateTo);
  if (options.returnState) params.set("return_state", options.returnState);
  if (options.role) params.set("role", options.role);
  params.set("limit", String(options.limit ?? 200));
  params.set("offset", String(options.offset ?? 0));
  // Note: sort param causes HTTP 500 when combined with role=BUYER

  const url = `${POST_ORDER_BASE}/return/search?${params.toString()}`;
  console.log(`[Post-Order] Searching returns: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Post-Order] Search returns failed (${response.status}):`, text);
    throw new Error(`Search returns failed: ${response.status} - ${text}`);
  }

  const data = await response.json();

  // Normalize: API might return empty response or missing members
  return {
    members: data.members ?? [],
    total: data.total,
    paginationOutput: data.paginationOutput ?? {
      totalEntries: data.total ?? 0,
      totalPages: 0,
      offset: 0,
      limit: 200,
    },
  };
}

// ============================================================
// SEARCH INQUIRIES (INR)
// ============================================================

export async function searchInquiries(
  token: string,
  options: {
    dateFrom?: string;
    dateTo?: string;
    inquiryStatus?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<SearchInquiriesResponse> {
  const params = new URLSearchParams();

  if (options.dateFrom) params.set("inquiry_creation_date_range_from", options.dateFrom);
  if (options.dateTo) params.set("inquiry_creation_date_range_to", options.dateTo);
  if (options.inquiryStatus) params.set("inquiry_status", options.inquiryStatus);
  params.set("limit", String(options.limit ?? 200));
  params.set("offset", String(options.offset ?? 0));
  params.set("sort", "Descending");

  const url = `${POST_ORDER_BASE}/inquiry/search?${params.toString()}`;
  console.log(`[Post-Order] Searching inquiries: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Post-Order] Search inquiries failed (${response.status}):`, text);
    throw new Error(`Search inquiries failed: ${response.status} - ${text}`);
  }

  const data = await response.json();

  return {
    members: data.members ?? [],
    paginationOutput: data.paginationOutput ?? {
      totalEntries: 0,
      totalPages: 0,
      offset: 0,
      limit: 200,
    },
  };
}

// ============================================================
// GET SINGLE RETURN DETAILS
// ============================================================

export async function getReturn(token: string, returnId: string): Promise<any> {
  const url = `${POST_ORDER_BASE}/return/${returnId}`;
  console.log(`[Post-Order] Getting return: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Post-Order] Get return failed (${response.status}):`, text);
    throw new Error(`Get return failed: ${response.status} - ${text}`);
  }

  return response.json();
}

// ============================================================
// GET SINGLE INQUIRY DETAILS
// ============================================================

export async function getInquiry(token: string, inquiryId: string): Promise<any> {
  const url = `${POST_ORDER_BASE}/inquiry/${inquiryId}`;
  console.log(`[Post-Order] Getting inquiry: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Post-Order] Get inquiry failed (${response.status}):`, text);
    throw new Error(`Get inquiry failed: ${response.status} - ${text}`);
  }

  return response.json();
}
