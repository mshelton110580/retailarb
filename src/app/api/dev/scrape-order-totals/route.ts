import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const BATCH_SIZE = 15;

/**
 * POST /api/dev/scrape-order-totals
 *
 * Enqueues order_scrape_batch_job jobs (15 orders per job) for all orders
 * where original_total IS NULL.
 * ADMIN only.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reset = body.reset === true;

  const orders = await prisma.orders.findMany({
    where: {
      original_total: null,
      ...(reset ? {} : { scrape_state: { not: "NEEDS_LOGIN" } })
    },
    select: { order_id: true },
    orderBy: { purchase_date: "desc" }
  });

  if (orders.length === 0) {
    return NextResponse.json({ ok: true, enqueued: 0, batches: 0, total: 0 });
  }

  // Chunk into batches of BATCH_SIZE
  const batches: string[][] = [];
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    batches.push(orders.slice(i, i + BATCH_SIZE).map(o => o.order_id));
  }

  const queue = new Queue("order_scrape_batch_job", { connection: connection as any });
  for (const batch of batches) {
    await queue.add("batch", { orderIds: batch }, { removeOnComplete: 50, removeOnFail: 20 });
  }

  // Mark all as PENDING
  await prisma.orders.updateMany({
    where: {
      original_total: null,
      ...(reset ? {} : { scrape_state: { not: "NEEDS_LOGIN" } })
    },
    data: { scrape_state: "PENDING" }
  });

  return NextResponse.json({
    ok: true,
    enqueued: orders.length,
    batches: batches.length,
    total: orders.length
  });
}

/**
 * GET /api/dev/scrape-order-totals
 *
 * Returns current scrape progress stats and Chrome profile session status.
 */
export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [total, withOriginal, byState, accounts] = await Promise.all([
    prisma.orders.count(),
    prisma.orders.count({ where: { original_total: { not: null } } }),
    prisma.orders.groupBy({
      by: ["scrape_state"],
      _count: { scrape_state: true }
    }),
    prisma.ebay_accounts.findMany({
      select: { id: true, ebay_username: true }
    })
  ]);

  const stateMap: Record<string, number> = {};
  for (const row of byState) {
    stateMap[row.scrape_state ?? "null"] = row._count.scrape_state;
  }

  // Check session availability: persistent profile dir OR playwright_state in DB
  const { existsSync } = await import("fs");
  const profileDir = process.env.EBAY_CHROME_PROFILE ?? "/opt/retailarb/chrome-profile";
  const hasProfileDir = existsSync(profileDir);

  // Also fetch playwright_state to show per-account session status
  const accountsWithState = await prisma.ebay_accounts.findMany({
    select: { id: true, ebay_username: true, playwright_state: true }
  });

  const sessionStatus = accountsWithState.map(a => ({
    id: a.id,
    username: a.ebay_username,
    hasSession: hasProfileDir || (!!a.playwright_state && a.playwright_state.length > 10),
    sessionType: hasProfileDir ? "profile" : (!!a.playwright_state && a.playwright_state.length > 10 ? "cookies" : "none")
  }));

  return NextResponse.json({
    total,
    withOriginal,
    needsScrape: total - withOriginal,
    states: stateMap,
    sessionStatus,
    profileDir,
    hasProfileDir
  });
}
