import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

/**
 * POST /api/dev/scrape-order-totals
 *
 * Enqueues order_scrape_job for every order where original_total IS NULL.
 * ADMIN only. Returns counts of queued jobs.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reset = body.reset === true; // re-queue FAILED orders too

  const where: Record<string, unknown> = { original_total: null };
  if (!reset) {
    // Skip orders already queued or in progress (PENDING state means already enqueued this session)
    where.scrape_state = { not: "PENDING" };
    // Actually — enqueue all NULL original_total orders, worker skips if already DONE
  }

  const orders = await prisma.orders.findMany({
    where: { original_total: null },
    select: { order_id: true, scrape_state: true }
  });

  const queue = new Queue("order_scrape_job", { connection: connection as any });

  let enqueued = 0;
  for (const order of orders) {
    // Skip if already marked DONE (shouldn't happen since we filter original_total=null, but safety check)
    if (order.scrape_state === "DONE") continue;
    // Skip NEEDS_LOGIN unless reset=true
    if (!reset && order.scrape_state === "NEEDS_LOGIN") continue;

    await queue.add(
      "scrape",
      { orderId: order.order_id },
      { removeOnComplete: 100, removeOnFail: 50 }
    );
    enqueued++;
  }

  // Mark enqueued orders as PENDING so the UI can show progress
  if (enqueued > 0) {
    await prisma.orders.updateMany({
      where: {
        original_total: null,
        scrape_state: reset ? undefined : { not: "NEEDS_LOGIN" }
      },
      data: { scrape_state: "PENDING" }
    });
  }

  return NextResponse.json({
    ok: true,
    enqueued,
    total: orders.length
  });
}

/**
 * GET /api/dev/scrape-order-totals
 *
 * Returns current scrape progress stats.
 */
export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [total, withOriginal, byState] = await Promise.all([
    prisma.orders.count(),
    prisma.orders.count({ where: { original_total: { not: null } } }),
    prisma.orders.groupBy({
      by: ["scrape_state"],
      _count: { scrape_state: true }
    })
  ]);

  const stateMap: Record<string, number> = {};
  for (const row of byState) {
    stateMap[row.scrape_state ?? "null"] = row._count.scrape_state;
  }

  return NextResponse.json({
    total,
    withOriginal,
    needsScrape: total - withOriginal,
    states: stateMap
  });
}
