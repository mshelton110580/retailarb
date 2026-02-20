import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getOrders } from "@/lib/ebay/trading";
import { getValidAccessToken } from "@/lib/ebay/token";

/**
 * POST /api/dev/backfill-original-totals
 *
 * Re-fetches all orders from the eBay Trading API and populates
 * original_total from the Subtotal / AdjustmentAmount fields.
 * The Trading API returns Subtotal (pre-refund) and AdjustmentAmount
 * (negative = refund issued) on every order, regardless of refund status.
 *
 * ADMIN only. Safe to run multiple times.
 */
export async function POST() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const accounts = await prisma.ebay_accounts.findMany({ select: { id: true } });
  if (!accounts.length) return NextResponse.json({ error: "No eBay accounts" }, { status: 404 });

  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const account of accounts) {
    try {
      const { token } = await getValidAccessToken(account.id);

      // Trading API max window is 90 days — chunk into 30-day windows to be safe
      const windowDays = 30;
      const start = new Date("2025-11-01T00:00:00Z");
      const end = new Date();
      const allOrders: Awaited<ReturnType<typeof getOrders>>["orders"] = [];

      let cursor = new Date(start);
      while (cursor < end) {
        const windowEnd = new Date(cursor);
        windowEnd.setDate(windowEnd.getDate() + windowDays);
        const until = windowEnd > end ? end : windowEnd;
        const result = await getOrders(token, cursor.toISOString(), until.toISOString());
        allOrders.push(...result.orders);
        cursor = until;
      }

      // Deduplicate (windows can overlap on the boundary)
      const seen = new Set<string>();
      const uniqueOrders = allOrders.filter(o => {
        if (seen.has(o.orderId)) return false;
        seen.add(o.orderId);
        return true;
      });

      for (const order of uniqueOrders) {
        // original_total = Total - AdjustmentAmount (AdjustmentAmount is negative for refunds)
        // Subtotal = items only (no shipping) — do NOT use
        const adjustmentNum = parseFloat(order.adjustmentAmount);
        const originalTotal = parseFloat((parseFloat(order.total) - adjustmentNum).toFixed(2));

        const existing = await prisma.orders.findUnique({
          where: { order_id: order.orderId },
          select: { original_total: true }
        });

        if (!existing) continue; // order not in our DB, skip

        await prisma.orders.update({
          where: { order_id: order.orderId },
          data: { original_total: originalTotal }
        });
        updated++;
      }
    } catch (err) {
      console.error("backfill-original-totals error:", err);
      errors++;
    }
  }

  // For orders older than 90 days (beyond Trading API range), fall back to
  // returns + INR data already in the DB: original_total = current_total + refunds
  const oldOrders = await prisma.$queryRaw<Array<{
    order_id: string;
    current_total: string;
    returns_refunded: string;
    inr_claimed: string;
  }>>`
    SELECT o.order_id,
      (o.totals->>'total')::numeric as current_total,
      COALESCE(SUM(r.actual_refund), 0)::numeric as returns_refunded,
      COALESCE(SUM(i.claim_amount), 0)::numeric as inr_claimed
    FROM orders o
    LEFT JOIN returns r ON r.order_id = o.order_id
    LEFT JOIN inr_cases i ON i.order_id = o.order_id
    WHERE o.original_total IS NULL
    GROUP BY o.order_id, o.totals
  `;

  for (const row of oldOrders) {
    const currentTotal = parseFloat(row.current_total) || 0;
    const refunds = parseFloat(row.returns_refunded) || 0;
    const inr = parseFloat(row.inr_claimed) || 0;
    const originalTotal = parseFloat((currentTotal + refunds + inr).toFixed(2));
    await prisma.orders.update({
      where: { order_id: row.order_id },
      data: { original_total: originalTotal }
    });
    updated++;
  }

  return NextResponse.json({ ok: true, updated, unchanged, errors });
}

/**
 * GET /api/dev/backfill-original-totals
 * Returns current progress: how many orders have original_total set.
 */
export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [total, withOriginal] = await Promise.all([
    prisma.orders.count(),
    prisma.orders.count({ where: { original_total: { not: null } } })
  ]);

  return NextResponse.json({ total, withOriginal, missing: total - withOriginal });
}
