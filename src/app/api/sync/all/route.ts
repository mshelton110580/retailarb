import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";

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

  const base = new URL(req.url).origin;
  const headers = { "Content-Type": "application/json", Cookie: req.headers.get("cookie") ?? "" };

  // Step 1: Sync orders
  let ordersResult: any = {};
  try {
    const res = await fetch(`${base}/api/orders/sync`, { method: "POST", headers, body: JSON.stringify({}) });
    ordersResult = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: `Order sync failed: ${ordersResult.error ?? "unknown"}` }, { status: 500 });
    }
    console.log(`[Sync All] Orders complete: ${ordersResult.synced} orders`);
  } catch (err: any) {
    return NextResponse.json({ error: `Order sync error: ${err.message}` }, { status: 500 });
  }

  // Step 2: Sync returns + INR (orders must exist first so order_ids can be resolved)
  let returnsResult: any = {};
  try {
    const res = await fetch(`${base}/api/sync/returns`, { method: "POST", headers });
    returnsResult = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: `Returns sync failed: ${returnsResult.error ?? "unknown"}` }, { status: 500 });
    }
    console.log(`[Sync All] Returns complete: ${returnsResult.synced?.returns} returns, ${returnsResult.synced?.inquiries} INR, ${returnsResult.synced?.cases} cases`);
  } catch (err: any) {
    return NextResponse.json({ error: `Returns sync error: ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    orders: ordersResult.synced ?? 0,
    returns: returnsResult.synced?.returns ?? 0,
    inquiries: returnsResult.synced?.inquiries ?? 0,
    cases: returnsResult.synced?.cases ?? 0,
    errors: returnsResult.errors ?? [],
  });
}
