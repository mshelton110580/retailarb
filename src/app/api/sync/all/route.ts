import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { syncOrders } from "@/app/api/orders/sync/route";
import { syncReturnsAndINR } from "@/app/api/sync/returns/route";

/**
 * POST /api/sync/all
 * Runs order sync followed by returns/INR sync in sequence.
 * Orders must complete first so returns/INR can resolve their order_ids.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Step 1: Sync orders
  let ordersResult: { synced: number };
  try {
    ordersResult = await syncOrders();
    console.log(`[Sync All] Orders complete: ${ordersResult.synced} orders`);
  } catch (err: any) {
    console.error("[Sync All] Order sync failed:", err);
    return NextResponse.json({ error: `Order sync error: ${err.message}` }, { status: 500 });
  }

  // Step 2: Sync returns + INR (orders must exist first so order_ids can be resolved)
  let returnsResult: { returns: number; inquiries: number; cases: number; errors: string[] };
  try {
    returnsResult = await syncReturnsAndINR();
    console.log(`[Sync All] Returns complete: ${returnsResult.returns} returns, ${returnsResult.inquiries} INR, ${returnsResult.cases} cases`);
  } catch (err: any) {
    console.error("[Sync All] Returns sync failed:", err);
    return NextResponse.json({ error: `Returns sync error: ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    orders: ordersResult.synced,
    returns: returnsResult.returns,
    inquiries: returnsResult.inquiries,
    cases: returnsResult.cases,
    errors: returnsResult.errors.length > 0 ? returnsResult.errors : undefined,
  });
}
