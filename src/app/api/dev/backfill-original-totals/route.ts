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

      // Fetch all orders from the beginning of our data range
      const since = new Date("2025-11-01T00:00:00Z");
      const until = new Date();

      const result = await getOrders(token, since.toISOString(), until.toISOString());

      for (const order of result.orders) {
        const subtotalNum = parseFloat(order.subtotal);
        const adjustmentNum = parseFloat(order.adjustmentAmount);
        const originalTotal = subtotalNum > 0
          ? subtotalNum
          : parseFloat((parseFloat(order.total) - adjustmentNum).toFixed(2));

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
