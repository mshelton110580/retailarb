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
 * Searches the last 90 days (3 x 30-day windows, same as order sync).
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
    // Build 90-day windows (3 x 30 days) for searching
    const windows: Array<{ from: string; to: string }> = [];
    for (let i = 2; i >= 0; i--) {
      const to = new Date(now);
      to.setDate(now.getDate() - i * 30);
      const from = new Date(to);
      from.setDate(to.getDate() - 30);
      windows.push({
        from: (i === 2 ? from : from).toISOString(),
        to: (i === 0 ? now : to).toISOString(),
      });
    }

    let totalReturns = 0;
    let totalInquiries = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      const { token } = await getValidAccessToken(account.id);

      // ============================================================
      // SYNC RETURNS
      // ============================================================
      for (const window of windows) {
        try {
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            const result = await searchReturns(token, {
              dateFrom: window.from,
              dateTo: window.to,
              role: "BUYER",
              limit: 200,
              offset,
            });

            for (const ret of result.members) {
              await upsertReturn(ret);
              totalReturns++;
            }

            // Check pagination
            const total = result.paginationOutput.totalEntries;
            offset += result.members.length;
            hasMore = offset < total && result.members.length > 0;
          }
        } catch (err: any) {
          console.error(`[Sync Returns] Window ${window.from} - ${window.to} failed:`, err.message);
          errors.push(`Returns ${window.from.slice(0, 10)}: ${err.message}`);
        }
      }

      // ============================================================
      // SYNC INQUIRIES (INR)
      // ============================================================
      for (const window of windows) {
        try {
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            const result = await searchInquiries(token, {
              dateFrom: window.from,
              dateTo: window.to,
              limit: 200,
              offset,
            });

            for (const inq of result.members) {
              await upsertInquiry(inq);
              totalInquiries++;
            }

            // Check pagination
            const total = result.paginationOutput.totalEntries;
            offset += result.members.length;
            hasMore = offset < total && result.members.length > 0;
          }
        } catch (err: any) {
          console.error(`[Sync Inquiries] Window ${window.from} - ${window.to} failed:`, err.message);
          errors.push(`Inquiries ${window.from.slice(0, 10)}: ${err.message}`);
        }
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
// UPSERT HELPERS
// ============================================================

async function upsertReturn(ret: EbayReturnSummary) {
  const returnId = String(ret.returnId);
  const itemId = String(ret.itemId ?? "");
  const orderId = ret.orderId ? String(ret.orderId) : null;

  // Try to find the order by item_id if orderId not directly available
  let resolvedOrderId = orderId;
  if (!resolvedOrderId && itemId) {
    const orderItem = await prisma.order_items.findFirst({
      where: { item_id: itemId },
      select: { order_id: true },
    });
    resolvedOrderId = orderItem?.order_id ?? null;
  }

  if (!resolvedOrderId) {
    console.warn(`[Sync Returns] Cannot find order for return ${returnId} (item: ${itemId})`);
    return;
  }

  // Check if order exists in our database
  const orderExists = await prisma.orders.findUnique({
    where: { order_id: resolvedOrderId },
    select: { order_id: true },
  });
  if (!orderExists) {
    console.warn(`[Sync Returns] Order ${resolvedOrderId} not in database, skipping return ${returnId}`);
    return;
  }

  // Check if item_id exists as a listing (for the optional relation)
  let validItemId: string | null = null;
  if (itemId) {
    const listing = await prisma.listings.findUnique({
      where: { item_id: itemId },
      select: { item_id: true },
    });
    validItemId = listing ? itemId : null;
  }

  // Extract refund amount
  const refundAmount =
    ret.buyerTotalRefund?.actualRefundAmount?.value ??
    ret.buyerTotalRefund?.estimatedRefundAmount?.value ??
    ret.totalRefundAmount?.value ??
    null;
  const refundCurrency =
    ret.buyerTotalRefund?.actualRefundAmount?.currency ??
    ret.buyerTotalRefund?.estimatedRefundAmount?.currency ??
    ret.totalRefundAmount?.currency ??
    null;

  const data = {
    order_id: resolvedOrderId,
    item_id: validItemId,
    ebay_state: ret.state ?? null,
    ebay_status: ret.status ?? null,
    ebay_type: ret.currentType ?? null,
    return_reason: (ret as any).returnReason ?? null,
    buyer_login_name: ret.buyerLoginName ?? null,
    seller_login_name: ret.sellerLoginName ?? null,
    refund_amount: refundAmount,
    refund_currency: refundCurrency,
    creation_date: ret.creationDate ? new Date(ret.creationDate) : null,
    last_modified: ret.lastModifiedDate ? new Date(ret.lastModifiedDate) : null,
    respond_by_date: ret.respondByDate ? new Date(ret.respondByDate) : null,
    escalated: ret.escalationInfo?.escalateStatus === "ESCALATED",
    last_synced_at: new Date(),
  };

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

async function upsertInquiry(inq: EbayInquirySummary) {
  const inquiryId = String(inq.inquiryId);
  const itemId = String(inq.itemId ?? "");

  // Find the order by item_id
  let resolvedOrderId: string | null = null;
  if (itemId) {
    const orderItem = await prisma.order_items.findFirst({
      where: { item_id: itemId },
      select: { order_id: true },
    });
    resolvedOrderId = orderItem?.order_id ?? null;
  }

  if (!resolvedOrderId) {
    console.warn(`[Sync Inquiries] Cannot find order for inquiry ${inquiryId} (item: ${itemId})`);
    return;
  }

  // Check if order exists
  const orderExists = await prisma.orders.findUnique({
    where: { order_id: resolvedOrderId },
    select: { order_id: true },
  });
  if (!orderExists) {
    console.warn(`[Sync Inquiries] Order ${resolvedOrderId} not in database, skipping inquiry ${inquiryId}`);
    return;
  }

  // Check if item_id exists as a listing
  let validItemId: string | null = null;
  if (itemId) {
    const listing = await prisma.listings.findUnique({
      where: { item_id: itemId },
      select: { item_id: true },
    });
    validItemId = listing ? itemId : null;
  }

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
