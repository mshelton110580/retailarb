import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getReceivingEntries, RECEIVING_PAGE_SIZE } from "@/lib/receiving-entries";

/**
 * GET /api/receiving/entries?offset=50&range=30
 * Returns a batch of grouped receiving-log entries for lazy loading.
 * Accepts the same range/from/to params as the receiving page.
 */
export async function GET(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const dateRange = getDateRangeFromParams({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  }, 30);

  const { entries } = await getReceivingEntries(dateRange);

  return NextResponse.json({
    entries: entries.slice(offset, offset + RECEIVING_PAGE_SIZE),
    total: entries.length
  });
}
