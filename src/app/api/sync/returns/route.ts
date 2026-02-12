import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getValidAccessToken } from "@/lib/ebay/token";
import {
  searchReturns,
  searchInquiries,
  type EbayReturnSummary,
  type EbayInquirySummary,
} from "@/lib/ebay/post-order";

/**
 * POST /api/sync/returns
 * Syncs return requests and INR inquiries from eBay Post-Order API.
 * Searches the last 90 days in a single call (limit=200, paginated).
 *
 * Returns are searched with role=BUYER since this is a buyer account.
 * All cases are stored regardless of whether they match a purchase order.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const accounts = await prisma.ebay_accounts.findMany({ select: { id: true } });
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No eBay accounts connected" }, { status: 400 });
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);

    const dateFrom = ninetyDaysAgo.toISOString();
    const dateTo = now.toISOString();

    let totalReturns = 0;
    let totalInquiries = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      // Get a fresh token for each account
      const { token } = await getValidAccessToken(account.id);

      // ============================================================
      // SYNC RETURNS (role=BUYER — we are the buyer)
      // ============================================================
      try {
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const result = await searchReturns(token, {
            dateFrom,
            dateTo,
            role: "BUYER",
            limit: 200,
            offset,
          });

          console.log(`[Sync Returns] Got ${result.members.length} returns (offset=${offset}, total=${result.paginationOutput.totalEntries})`);

          for (const ret of result.members) {
            try {
              await upsertReturn(ret);
              totalReturns++;
            } catch (err: any) {
              console.error(`[Sync Returns] Failed to upsert return ${ret.returnId}:`, err.message);
            }
          }

          const total = result.paginationOutput.totalEntries;
          offset += result.members.length;
          hasMore = offset < total && result.members.length > 0;
        }
      } catch (err: any) {
        console.error(`[Sync Returns] Failed:`, err.message);
        errors.push(`Returns: ${err.message}`);
      }

      // ============================================================
      // SYNC INQUIRIES (INR)
      // ============================================================
      try {
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const result = await searchInquiries(token, {
            dateFrom,
            dateTo,
            limit: 200,
            offset,
          });

          console.log(`[Sync Inquiries] Got ${result.members.length} inquiries (offset=${offset}, total=${result.paginationOutput.totalEntries})`);

          for (const inq of result.members) {
            try {
              await upsertInquiry(inq);
              totalInquiries++;
            } catch (err: any) {
              console.error(`[Sync Inquiries] Failed to upsert inquiry ${inq.inquiryId}:`, err.message);
            }
          }

          const total = result.paginationOutput.totalEntries;
          offset += result.members.length;
          hasMore = offset < total && result.members.length > 0;
        }
      } catch (err: any) {
        console.error(`[Sync Inquiries] Failed:`, err.message);
        errors.push(`Inquiries: ${err.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      synced: { returns: totalReturns, inquiries: totalInquiries },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("Return/INR sync failed:", error);
    return NextResponse.json({ error: error.message ?? "Sync failed" }, { status: 500 });
  }
}

// ============================================================
// HELPERS: Try to resolve order_id and item_id to existing DB records
// ============================================================

/** Try to find a matching order_id in our database */
async function resolveOrderId(itemId: string | null, rawOrderId: string | null): Promise<string | null> {
  // First try the orderId from the API directly
  if (rawOrderId) {
    const order = await prisma.orders.findUnique({
      where: { order_id: rawOrderId },
      select: { order_id: true },
    });
    if (order) return order.order_id;
  }

  // Try to find by item_id in order_items
  if (itemId) {
    const orderItem = await prisma.order_items.findFirst({
      where: { item_id: itemId },
      select: { order_id: true },
    });
    if (orderItem) return orderItem.order_id;
  }

  return null;
}

/** Check if item_id exists as a listing (for the optional FK) */
async function resolveListingItemId(itemId: string | null): Promise<string | null> {
  if (!itemId) return null;
  const listing = await prisma.listings.findUnique({
    where: { item_id: itemId },
    select: { item_id: true },
  });
  return listing ? itemId : null;
}

// ============================================================
// UPSERT RETURN
// ============================================================

async function upsertReturn(ret: EbayReturnSummary) {
  const returnId = String(ret.returnId);

  // Extract nested fields from the actual API response structure
  const itemId = ret.creationInfo?.item?.itemId
    ? String(ret.creationInfo.item.itemId)
    : null;
  const rawOrderId = ret.orderId ? String(ret.orderId) : null;

  const resolvedOrderId = await resolveOrderId(itemId, rawOrderId);
  const validItemId = await resolveListingItemId(itemId);

  // Extract refund amount — prefer actual over estimated
  const refundAmount =
    ret.buyerTotalRefund?.actualRefundAmount?.value ??
    ret.buyerTotalRefund?.estimatedRefundAmount?.value ??
    null;
  const refundCurrency =
    ret.buyerTotalRefund?.actualRefundAmount?.currency ??
    ret.buyerTotalRefund?.estimatedRefundAmount?.currency ??
    null;

  // Extract dates from nested structure
  const creationDateStr = ret.creationInfo?.creationDate?.value ?? null;
  const respondByStr =
    ret.buyerResponseDue?.respondByDate?.value ??
    ret.sellerResponseDue?.respondByDate?.value ??
    null;

  // Extract return reason from creationInfo
  const returnReason = ret.creationInfo?.reason ?? null;

  const data = {
    order_id: resolvedOrderId,
    item_id: validItemId,
    ebay_state: ret.state ?? null,
    ebay_status: ret.status ?? null,
    ebay_type: ret.currentType ?? null,
    return_reason: returnReason,
    buyer_login_name: ret.buyerLoginName ?? null,
    seller_login_name: ret.sellerLoginName ?? null,
    refund_amount: refundAmount,
    refund_currency: refundCurrency,
    creation_date: creationDateStr ? new Date(creationDateStr) : null,
    respond_by_date: respondByStr ? new Date(respondByStr) : null,
    escalated: false, // The response structure doesn't have a simple escalated flag; check status instead
    last_synced_at: new Date(),
  };

  // Check if status indicates escalation
  if (ret.status === "ESCALATED" || ret.state === "ESCALATED") {
    data.escalated = true;
  }

  const existing = await prisma.returns.findUnique({
    where: { ebay_return_id: returnId },
  });

  if (existing) {
    await prisma.returns.update({
      where: { ebay_return_id: returnId },
      data,
    });
  } else {
    await prisma.returns.create({
      data: {
        ...data,
        ebay_return_id: returnId,
        scrape_state: "COMPLETE",
        status_scraped: ret.status ?? ret.state ?? "synced",
      },
    });
  }
}

// ============================================================
// UPSERT INQUIRY (INR)
// ============================================================

async function upsertInquiry(inq: EbayInquirySummary) {
  const inquiryId = String(inq.inquiryId);
  const itemId = inq.itemId ? String(inq.itemId) : null;

  const resolvedOrderId = await resolveOrderId(itemId, null);
  const validItemId = await resolveListingItemId(itemId);

  const creationDateStr = inq.creationDate?.value ?? null;
  const lastModifiedStr = inq.lastModifiedDate?.value ?? null;
  const respondByStr = inq.respondByDate?.value ?? null;

  const data = {
    order_id: resolvedOrderId,
    item_id: validItemId,
    ebay_status: inq.inquiryStatusEnum ?? null,
    ebay_state: inq.inquiryStatusEnum ?? null,
    claim_amount: inq.claimAmount?.value ?? null,
    claim_currency: inq.claimAmount?.currency ?? null,
    creation_date: creationDateStr ? new Date(creationDateStr) : null,
    last_modified: lastModifiedStr ? new Date(lastModifiedStr) : null,
    respond_by_date: respondByStr ? new Date(respondByStr) : null,
    buyer_login_name: inq.buyer ?? null,
    escalated_to_case: inq.escalationInfo?.escalateStatus === "ESCALATED",
    case_id: inq.escalationInfo?.caseId ?? null,
    last_synced_at: new Date(),
  };

  const existing = await prisma.inr_cases.findUnique({
    where: { ebay_inquiry_id: inquiryId },
  });

  if (existing) {
    await prisma.inr_cases.update({
      where: { ebay_inquiry_id: inquiryId },
      data,
    });
  } else {
    await prisma.inr_cases.create({
      data: {
        ...data,
        ebay_inquiry_id: inquiryId,
        status_text: inq.inquiryStatusEnum ?? "synced",
      },
    });
  }
}
