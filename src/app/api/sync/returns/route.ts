import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getValidAccessToken } from "@/lib/ebay/token";
import {
  searchReturns,
  searchInquiries,
  searchCases,
  getReturnTracking,
  getReturnDetail,
  getInquiry,
  type EbayReturnSummary,
  type EbayInquirySummary,
  type EbayCaseSummary,
} from "@/lib/ebay/post-order";
import { updateInventoryStatesFromReturns } from "@/lib/inventory-transitions";

/**
 * POST /api/sync/returns
 * Syncs return requests, INR inquiries, and escalated/direct cases from eBay Post-Order API.
 * Searches the last 90 days to match the order sync window (full pagination).
 *
 * Three sync steps:
 * 1. Returns (role=BUYER) — buyer return requests
 * 2. Inquiries — INR inquiries filed by the buyer
 * 3. Cases — escalated INR cases and direct cases (skipped inquiry step)
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

    // Match the order sync window: 90 days
    // (eBay Post-Order API allows up to 18 months, but we sync 90 days to match order history)
    const EARLIEST_DATE = new Date(now);
    EARLIEST_DATE.setDate(EARLIEST_DATE.getDate() - 90);
    const windows: Array<{ from: string; to: string }> = [{
      from: EARLIEST_DATE.toISOString(),
      to: now.toISOString(),
    }];
    console.log(`[Return/INR Sync] Syncing from ${EARLIEST_DATE.toISOString()} to ${now.toISOString()} (90-day window to match orders)`);

    let totalReturns = 0;
    let totalInquiries = 0;
    let totalCases = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      // Get a fresh token for each account
      const { token } = await getValidAccessToken(account.id);

      // ============================================================
      // STEP 1: SYNC RETURNS (role=BUYER — we are the buyer)
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

            console.log(`[Sync Returns] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)}: Got ${result.members.length} returns (offset=${offset}, total=${result.paginationOutput.totalEntries})`);

            for (const ret of result.members) {
              try {
                await upsertReturn(ret, token);
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
          console.error(`[Sync Returns] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)} failed:`, err.message);
          errors.push(`Returns (${window.from.slice(0,10)}): ${err.message}`);
        }
      }

      // ============================================================
      // STEP 2: SYNC INQUIRIES (INR)
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

            console.log(`[Sync Inquiries] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)}: Got ${result.members.length} inquiries (offset=${offset}, total=${result.paginationOutput.totalEntries})`);

            for (const inq of result.members) {
              try {
                await upsertInquiry(inq, token);
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
          console.error(`[Sync Inquiries] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)} failed:`, err.message);
          errors.push(`Inquiries (${window.from.slice(0,10)}): ${err.message}`);
        }
      }

      // ============================================================
      // STEP 3: SYNC CASES (escalated INR / direct cases)
      // These are cases that either:
      //   a) Were escalated from an inquiry (already have an inquiry record)
      //   b) Were filed directly as a case (no inquiry record exists)
      // We store direct cases as new inr_cases records.
      // For escalated cases, we update the existing inquiry record.
      // ============================================================
      for (const window of windows) {
        try {
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            const result = await searchCases(token, {
              dateFrom: window.from,
              dateTo: window.to,
              limit: 200,
              offset,
            });

            console.log(`[Sync Cases] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)}: Got ${result.members.length} cases (offset=${offset}, total=${result.paginationOutput.totalEntries})`);

            for (const cs of result.members) {
              try {
                await upsertCase(cs);
                totalCases++;
              } catch (err: any) {
                console.error(`[Sync Cases] Failed to upsert case ${cs.caseId}:`, err.message);
              }
            }

            const total = result.paginationOutput.totalEntries;
            offset += result.members.length;
            hasMore = offset < total && result.members.length > 0;
          }
        } catch (err: any) {
          console.error(`[Sync Cases] Window ${window.from.slice(0,10)} to ${window.to.slice(0,10)} failed:`, err.message);
          errors.push(`Cases (${window.from.slice(0,10)}): ${err.message}`);
        }
      }
    }

    // After syncing all returns, update inventory states based on return statuses
    try {
      await updateInventoryStatesFromReturns();
      console.log("[Return Sync] Inventory states updated based on return statuses");
    } catch (err: any) {
      console.error("[Return Sync] Failed to update inventory states:", err.message);
      errors.push(`Inventory state update failed: ${err.message}`);
    }

    return NextResponse.json({
      ok: true,
      synced: { returns: totalReturns, inquiries: totalInquiries, cases: totalCases },
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

async function upsertReturn(ret: EbayReturnSummary, token: string) {
  const returnId = String(ret.returnId);

  // Extract nested fields from the actual API response structure
  const itemId = ret.creationInfo?.item?.itemId
    ? String(ret.creationInfo.item.itemId)
    : null;
  const rawOrderId = ret.orderId ? String(ret.orderId) : null;

  const resolvedOrderId = await resolveOrderId(itemId, rawOrderId);

  // Extract refund amounts — store actual and estimated separately
  const actualRefund = ret.buyerTotalRefund?.actualRefundAmount?.value ?? null;
  const estimatedRefund = ret.buyerTotalRefund?.estimatedRefundAmount?.value ?? null;
  // refund_amount keeps the best available (actual if present, else estimated)
  const refundAmount = actualRefund ?? estimatedRefund ?? null;
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

  // Fetch tracking information and full details
  let trackingInfo = null;
  let detailInfo = null;
  try {
    [trackingInfo, detailInfo] = await Promise.all([
      getReturnTracking(token, returnId),
      getReturnDetail(token, returnId),
    ]);
  } catch (err: any) {
    console.log(`[Sync Returns] Could not fetch tracking/details for ${returnId}:`, err.message);
  }

  const data: any = {
    order_id: resolvedOrderId,
    ebay_item_id: itemId,
    ebay_state: ret.state ?? null,
    ebay_status: ret.status ?? null,
    ebay_type: ret.currentType ?? null,
    return_reason: returnReason,
    buyer_login_name: ret.buyerLoginName ?? null,
    seller_login_name: ret.sellerLoginName ?? null,
    refund_amount: refundAmount,
    actual_refund: actualRefund,
    estimated_refund: estimatedRefund,
    refund_currency: refundCurrency,
    creation_date: creationDateStr ? new Date(creationDateStr) : null,
    respond_by_date: respondByStr ? new Date(respondByStr) : null,
    escalated: false,
    last_synced_at: new Date(),
  };

  // Add tracking info if available
  if (trackingInfo) {
    data.return_carrier = trackingInfo.trackingCarrierUsed ?? null;
    data.return_tracking_number = trackingInfo.trackingNumber ?? null;
    data.return_tracking_status = trackingInfo.trackingStatus ?? null;
    data.return_shipped_date = trackingInfo.shipmentDate?.value ? new Date(trackingInfo.shipmentDate.value) : null;
    data.return_delivered_date = trackingInfo.deliveredDate?.value ? new Date(trackingInfo.deliveredDate.value) : null;
  }

  // Add label info if available
  if (detailInfo?.returnShipment) {
    data.label_created_date = detailInfo.returnShipment.labelGeneratedDate?.value
      ? new Date(detailInfo.returnShipment.labelGeneratedDate.value)
      : null;
    data.label_url = detailInfo.returnShipment.labelDownloadURL ?? null;
    data.label_created_by = detailInfo.returnShipment.labelCreatedBy ?? null;
  }

  // Check if refund was issued
  if (actualRefund && actualRefund > 0) {
    // Set refund issued date based on state/status
    if (ret.state === "REFUND_ISSUED" || ret.state === "RETURN_CLOSED") {
      data.refund_issued_date = new Date();
    }
  }

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

async function upsertInquiry(inq: EbayInquirySummary, token: string) {
  const inquiryId = String(inq.inquiryId);
  const itemId = inq.itemId ? String(inq.itemId) : null;

  const resolvedOrderId = await resolveOrderId(itemId, null);

  // Fetch full inquiry details to get tracking/delivery information
  let fullInquiry: any = null;
  try {
    fullInquiry = await getInquiry(token, inquiryId);

    // Extract delivery information from inquiry tracking details
    if (resolvedOrderId && fullInquiry?.inquiryHistoryDetails?.shipmentTrackingDetails) {
      const trackingDetails = fullInquiry.inquiryHistoryDetails.shipmentTrackingDetails;

      // Check if the tracking shows delivered status
      if (trackingDetails.currentStatus === 'DELIVERED') {
        // Look for delivery date in the history
        const history = fullInquiry.inquiryHistoryDetails?.history || [];
        let deliveryDate: Date | null = null;

        // Search history for delivery-related events or system closure
        for (const event of history) {
          const eventDate = event.date?.value;
          const action = event.action?.toLowerCase() || '';

          // Look for case expiration (usually happens after delivery confirmation)
          if (action.includes('expired') && eventDate) {
            deliveryDate = new Date(eventDate);
            console.log(`[Sync Inquiries] Order ${resolvedOrderId}: Found delivery via case expiration on ${eventDate}`);
            break;
          }
        }

        // If we found a delivery date, update the shipment
        if (deliveryDate && resolvedOrderId) {
          try {
            const updated = await prisma.shipments.updateMany({
              where: { order_id: resolvedOrderId },
              data: {
                delivered_at: deliveryDate,
                last_refreshed_at: new Date()
              }
            });
            if (updated.count > 0) {
              console.log(`[Sync Inquiries] Order ${resolvedOrderId}: Updated delivery date to ${deliveryDate.toISOString()}`);
            }
          } catch (err: any) {
            console.error(`[Sync Inquiries] Failed to update shipment delivery for ${resolvedOrderId}:`, err.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[Sync Inquiries] Could not fetch full inquiry ${inquiryId}:`, err.message);
  }

  const creationDateStr = inq.creationDate?.value ?? null;
  const lastModifiedStr = inq.lastModifiedDate?.value ?? null;
  const respondByStr = inq.respondByDate?.value ?? null;

  const data = {
    order_id: resolvedOrderId,
    ebay_item_id: itemId,
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
    // Clean up any stale manual INR records for this order before creating the synced one
    if (resolvedOrderId) {
      await prisma.inr_cases.deleteMany({
        where: {
          order_id: resolvedOrderId,
          ebay_inquiry_id: { equals: null },
        },
      });
      // Also delete manual records with empty string ebay_inquiry_id
      await prisma.inr_cases.deleteMany({
        where: {
          order_id: resolvedOrderId,
          ebay_inquiry_id: "",
        },
      });
    }
    await prisma.inr_cases.create({
      data: {
        ...data,
        ebay_inquiry_id: inquiryId,
        status_text: inq.inquiryStatusEnum ?? "synced",
      },
    });
  }
}

// ============================================================
// UPSERT CASE (escalated or direct INR case)
// ============================================================

async function upsertCase(cs: EbayCaseSummary) {
  const caseId = String(cs.caseId);
  const itemId = cs.itemId ? String(cs.itemId) : null;

  const resolvedOrderId = await resolveOrderId(itemId, null);

  const creationDateStr = cs.creationDate?.value ?? null;
  const lastModifiedStr = cs.lastModifiedDate?.value ?? null;
  const respondByStr = cs.respondByDate?.value ?? null;

  // First, check if this case already exists as an escalated inquiry
  // (i.e., an inquiry was filed first, then escalated to this case)
  const existingByCase = await prisma.inr_cases.findFirst({
    where: { case_id: caseId },
  });

  if (existingByCase) {
    // Update the existing inquiry record with case details
    await prisma.inr_cases.update({
      where: { id: existingByCase.id },
      data: {
        ebay_item_id: itemId ?? existingByCase.ebay_item_id,
        order_id: resolvedOrderId ?? existingByCase.order_id,
        ebay_status: cs.caseStatusEnum ?? existingByCase.ebay_status,
        claim_amount: cs.claimAmount?.value ?? existingByCase.claim_amount,
        claim_currency: cs.claimAmount?.currency ?? existingByCase.claim_currency,
        creation_date: creationDateStr ? new Date(creationDateStr) : existingByCase.creation_date,
        last_modified: lastModifiedStr ? new Date(lastModifiedStr) : existingByCase.last_modified,
        respond_by_date: respondByStr ? new Date(respondByStr) : existingByCase.respond_by_date,
        escalated_to_case: true,
        last_synced_at: new Date(),
      },
    });
    return;
  }

  // Check if this case already exists as a direct case (stored with ebay_inquiry_id = "case-{caseId}")
  const directCaseId = `case-${caseId}`;
  const existingDirect = await prisma.inr_cases.findUnique({
    where: { ebay_inquiry_id: directCaseId },
  });

  const data = {
    order_id: resolvedOrderId,
    ebay_item_id: itemId,
    ebay_status: cs.caseStatusEnum ?? null,
    ebay_state: cs.caseStatusEnum ?? null,
    claim_amount: cs.claimAmount?.value ?? null,
    claim_currency: cs.claimAmount?.currency ?? null,
    creation_date: creationDateStr ? new Date(creationDateStr) : null,
    last_modified: lastModifiedStr ? new Date(lastModifiedStr) : null,
    respond_by_date: respondByStr ? new Date(respondByStr) : null,
    buyer_login_name: cs.buyer ?? null,
    escalated_to_case: true,
    case_id: caseId,
    last_synced_at: new Date(),
  };

  if (existingDirect) {
    await prisma.inr_cases.update({
      where: { ebay_inquiry_id: directCaseId },
      data,
    });
  } else {
    // Clean up any stale manual INR records for this order before creating the synced one
    const effectiveOrderId = resolvedOrderId;
    if (effectiveOrderId) {
      await prisma.inr_cases.deleteMany({
        where: {
          order_id: effectiveOrderId,
          ebay_inquiry_id: { equals: null },
        },
      });
      await prisma.inr_cases.deleteMany({
        where: {
          order_id: effectiveOrderId,
          ebay_inquiry_id: "",
        },
      });
    }
    await prisma.inr_cases.create({
      data: {
        ...data,
        ebay_inquiry_id: directCaseId,
        status_text: cs.caseStatusEnum ?? "synced",
      },
    });
  }
}
