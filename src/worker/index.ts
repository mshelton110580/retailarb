import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../lib/db";
import { getOrders } from "../lib/ebay/trading";
import { getItemByLegacyId } from "../lib/ebay/browse";
import { getValidAccessToken } from "../lib/ebay/token";
import { deriveShippingStatus } from "../lib/shipping";
import { saveFile } from "../lib/storage";
import { chromium } from "playwright";
import { placeProxyBid } from "../lib/ebay/offer";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

const syncOrdersWorker = new Worker(
  "sync_orders_job",
  async (job) => {
    const accountId = job.data.ebayAccountId;
    const accountIds = accountId
      ? [accountId]
      : (await prisma.ebay_accounts.findMany({ select: { id: true } })).map((acc) => acc.id);

    const now = new Date();
    const since = new Date(now);
    since.setDate(now.getDate() - 30);
    for (const id of accountIds) {
      const { token } = await getValidAccessToken(id);
      const result = await getOrders(token, since.toISOString(), now.toISOString());
      for (const order of result.orders) {
        await prisma.orders.upsert({
          where: { order_id: order.orderId },
          update: {
            order_status: order.orderStatus,
            totals: { total: order.total },
            ship_to_city: order.shippingAddress?.city,
            ship_to_state: order.shippingAddress?.state,
            ship_to_postal: order.shippingAddress?.postalCode,
            updated_at: new Date()
          },
          create: {
            order_id: order.orderId,
            ebay_account_id: id,
            purchase_date: new Date(order.createdTime),
            order_status: order.orderStatus,
            totals: { total: order.total },
            ship_to_city: order.shippingAddress?.city,
            ship_to_state: order.shippingAddress?.state,
            ship_to_postal: order.shippingAddress?.postalCode,
            order_url: `https://order.ebay.com/ord/show?orderId=${order.orderId}`,
            updated_at: new Date()
          }
        });

        for (const transaction of order.transactions) {
          const existingTarget = await prisma.targets.findUnique({
            where: { item_id: transaction.itemId }
          });
          if (existingTarget) {
            await prisma.targets.update({
              where: { item_id: transaction.itemId },
              data: {
                status: "PURCHASED",
                status_history: [
                  ...(existingTarget.status_history as any[]),
                  { status: "PURCHASED", at: new Date().toISOString() }
                ]
              }
            });
          } else {
            await prisma.targets.create({
              data: {
                item_id: transaction.itemId,
                type: "BIN",
                max_snipe_bid: null,
                best_offer_amount: null,
                lead_seconds: 5,
                created_by: order.orderId,
                status: "PURCHASED",
                status_history: [{ status: "PURCHASED", at: new Date().toISOString() }]
              }
            });
          }
          await prisma.order_items.upsert({
            where: { id: `${order.orderId}-${transaction.itemId}` },
            update: {
              title: transaction.title,
              qty: transaction.quantity,
              transaction_price: Number(transaction.transactionPrice),
              shipping_cost: transaction.shippingServiceCost
                ? Number(transaction.shippingServiceCost)
                : null,
              purchase_date: new Date(order.createdTime)
            },
            create: {
              id: `${order.orderId}-${transaction.itemId}`,
              order_id: order.orderId,
              item_id: transaction.itemId,
              title: transaction.title,
              qty: transaction.quantity,
              transaction_price: Number(transaction.transactionPrice),
              shipping_cost: transaction.shippingServiceCost
                ? Number(transaction.shippingServiceCost)
                : null,
              purchase_date: new Date(order.createdTime)
            }
          });
        }

        const derivedStatus = deriveShippingStatus({
          actualDelivery: order.delivery.actualDelivery,
          cancelStatus: null,
          scheduledMax: order.delivery.scheduledMax ?? null,
          estimatedMax: order.delivery.estimatedMax ?? null,
          hasTracking: order.shipments.length > 0,
          hasScheduledWindow: Boolean(order.delivery.scheduledMin || order.delivery.scheduledMax),
          hasEstimatedWindow: Boolean(order.delivery.estimatedMin || order.delivery.estimatedMax)
        });

        const shipment = await prisma.shipments.upsert({
          where: { id: `${order.orderId}-shipment` },
          update: {
            derived_status: derivedStatus,
            estimated_min: order.delivery.estimatedMin ? new Date(order.delivery.estimatedMin) : null,
            estimated_max: order.delivery.estimatedMax ? new Date(order.delivery.estimatedMax) : null,
            scheduled_min: order.delivery.scheduledMin ? new Date(order.delivery.scheduledMin) : null,
            scheduled_max: order.delivery.scheduledMax ? new Date(order.delivery.scheduledMax) : null,
            delivered_at: order.delivery.actualDelivery
              ? new Date(order.delivery.actualDelivery)
              : null,
            last_refreshed_at: new Date()
          },
          create: {
            id: `${order.orderId}-shipment`,
            order_id: order.orderId,
            derived_status: derivedStatus,
            estimated_min: order.delivery.estimatedMin ? new Date(order.delivery.estimatedMin) : null,
            estimated_max: order.delivery.estimatedMax ? new Date(order.delivery.estimatedMax) : null,
            scheduled_min: order.delivery.scheduledMin ? new Date(order.delivery.scheduledMin) : null,
            scheduled_max: order.delivery.scheduledMax ? new Date(order.delivery.scheduledMax) : null,
            delivered_at: order.delivery.actualDelivery
              ? new Date(order.delivery.actualDelivery)
              : null,
            last_refreshed_at: new Date()
          }
        });

        for (const tracking of order.shipments) {
          if (!tracking.trackingNumber) continue;
          await prisma.tracking_numbers.upsert({
            where: { id: `${shipment.id}-${tracking.trackingNumber}` },
            update: {
              carrier: tracking.carrier,
              tracking_number: tracking.trackingNumber,
              status_text: tracking.statusText,
              last_seen_at: new Date()
            },
            create: {
              id: `${shipment.id}-${tracking.trackingNumber}`,
              shipment_id: shipment.id,
              carrier: tracking.carrier,
              tracking_number: tracking.trackingNumber,
              status_text: tracking.statusText,
              last_seen_at: new Date()
            }
          });
        }
      }
      await prisma.ebay_accounts.update({
        where: { id },
        data: { last_sync_at: new Date() }
      });
    }
  },
  { connection: connection as any }
);

const enrichListingWorker = new Worker(
  "enrich_listing_job",
  async (job) => {
    const { itemId, ebayAccountId } = job.data;
    if (!itemId) return;
    const accountId = ebayAccountId
      ? ebayAccountId
      : (await prisma.ebay_accounts.findFirst({ select: { id: true } }))?.id;
    if (!accountId) return;
    const { token } = await getValidAccessToken(accountId);
    const item = await getItemByLegacyId(token, itemId);
    if (!item) return;
    await prisma.listings.upsert({
      where: { item_id: itemId },
      update: {
        title: item.title,
        end_time: item.endTime ? new Date(item.endTime) : null,
        current_price: Number(item.price),
        shipping_estimate: item.shippingCost ? Number(item.shippingCost) : null,
        buying_options: item.buyingOptions,
        gtin: item.gtin,
        brand: item.brand,
        mpn: item.mpn,
        raw_json: item.raw
      },
      create: {
        item_id: itemId,
        title: item.title,
        end_time: item.endTime ? new Date(item.endTime) : null,
        current_price: Number(item.price),
        shipping_estimate: item.shippingCost ? Number(item.shippingCost) : null,
        buying_options: item.buyingOptions,
        gtin: item.gtin,
        brand: item.brand,
        mpn: item.mpn,
        raw_json: item.raw
      }
    });
  },
  { connection: connection as any }
);

const returnsWorker = new Worker(
  "returns_scrape_job",
  async (job) => {
    const record = await prisma.returns.findUnique({
      where: { id: job.data.returnId },
      include: { order: { include: { ebay_account: true } } }
    });
    if (!record?.order?.ebay_account?.playwright_state) {
      await prisma.returns.update({
        where: { id: job.data.returnId },
        data: {
          scrape_state: "NEEDS_LOGIN",
          last_scraped_at: new Date(),
          scrape_attempts: { increment: 1 }
        }
      });
      return;
    }

    const browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== "false" });
    const context = await browser.newContext({
      storageState: JSON.parse(record.order.ebay_account.playwright_state)
    });
    const page = await context.newPage();
    await page.goto("https://www.ebay.com/returns", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const statusText = await page.locator("text=Return").first().textContent();
    let labelPath: string | null = null;
    const labelLink = page.locator("a:has-text(\"Download label\")").first();
    if (await labelLink.count()) {
      const [download] = await Promise.all([page.waitForEvent("download"), labelLink.click()]);
      const buffer = await download.createReadStream();
      if (buffer) {
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk as Buffer);
        }
        const content = Buffer.concat(chunks);
        labelPath = await saveFile(`returns/${record.id}/label.pdf`, content);
      }
    }
    await browser.close();

    await prisma.returns.update({
      where: { id: record.id },
      data: {
        status_scraped: statusText ?? record.status_scraped,
        label_pdf_path: labelPath ?? record.label_pdf_path,
        scrape_state: "ACTIVE",
        last_scraped_at: new Date(),
        scrape_attempts: { increment: 1 }
      }
    });
  },
  { connection: connection as any }
);

const snipeWorker = new Worker(
  "snipe_job",
  async (job) => {
    const target = await prisma.targets.findUnique({ where: { item_id: job.data.itemId } });
    if (!target || target.type !== "AUCTION") return;
    const featureEnabled = process.env.FEATURE_OFFER_API === "true";
    if (!featureEnabled) {
      await prisma.targets.update({
        where: { item_id: target.item_id },
        data: {
          status: "BID_ATTEMPTED",
          status_history: [
            ...(target.status_history as any[]),
            { status: "BID_ATTEMPTED", at: new Date().toISOString(), assisted: true }
          ]
        }
      });
      return;
    }
    const accountId = target.ebay_account_id;
    if (!accountId || !target.max_snipe_bid) return;
    const { token } = await getValidAccessToken(accountId);
    await placeProxyBid(token, target.item_id, target.max_snipe_bid.toString());
    await prisma.targets.update({
      where: { item_id: target.item_id },
      data: {
        status: "BID_ATTEMPTED",
        status_history: [
          ...(target.status_history as any[]),
          { status: "BID_ATTEMPTED", at: new Date().toISOString(), assisted: false }
        ]
      }
    });
  },
  { connection: connection as any }
);

const reconcileWorker = new Worker(
  "reconcile_auction_job",
  async (job) => {
    const target = await prisma.targets.findUnique({ where: { item_id: job.data.itemId } });
    if (!target) return;
    const orderItem = await prisma.order_items.findFirst({
      where: { item_id: target.item_id }
    });
    if (orderItem) {
      await prisma.targets.update({
        where: { item_id: target.item_id },
        data: {
          status: "WON",
          status_history: [
            ...(target.status_history as any[]),
            { status: "WON", at: new Date().toISOString() }
          ]
        }
      });
      return;
    }
    const accountId = target.ebay_account_id;
    if (!accountId) return;
    const { token } = await getValidAccessToken(accountId);
    const item = await getItemByLegacyId(token, target.item_id);
    if (!item?.endTime) return;
    const ended = new Date(item.endTime) < new Date();
    await prisma.targets.update({
      where: { item_id: target.item_id },
      data: {
        status: ended ? "LOST_OUTBID" : target.status,
        status_history: [
          ...(target.status_history as any[]),
          { status: ended ? "LOST_OUTBID" : target.status, at: new Date().toISOString() }
        ]
      }
    });
  },
  { connection: connection as any }
);

const alertsWorker = new Worker(
  "alerts_job",
  async () => {
    const shipments = await prisma.shipments.findMany();
    for (const shipment of shipments) {
      if (shipment.derived_status === "delivered") {
        continue;
      }
      await prisma.audit_log.create({
        data: {
          action: "shipment_status_checked",
          entity_type: "shipment",
          entity_id: shipment.id,
          payload_json: { status: shipment.derived_status }
        }
      });
    }
  },
  { connection: connection as any }
);

/**
 * order_scrape_batch_job
 *
 * Processes a batch of orders in a SINGLE browser session, reusing the same
 * browser context across all orders in the batch (much faster than opening a
 * new browser per order).
 *
 * Session strategy (in priority order):
 *   1. Persistent Chrome profile directory on disk (EBAY_CHROME_PROFILE env var or
 *      /opt/retailarb/chrome-profile) — set up once via scripts/ebay-login.js
 *   2. playwright_state JSON stored in the ebay_accounts table — set up via
 *      scripts/capture-ebay-session.js run locally
 *
 * Extraction logic (confirmed from live eBay order page):
 *   - "You got a refund! A total of $X.XX was sent…" banners → sum = total refunds
 *   - current_total comes from orders.totals->total (kept in sync by API)
 *   - original_total = current_total + total_refunds
 *
 * Targeted selectors are tried first; falls back to innerText regex if not found.
 */
const CHROME_PROFILE_DIR = process.env.EBAY_CHROME_PROFILE ?? "/opt/retailarb/chrome-profile";

const orderScrapeWorker = new Worker(
  "order_scrape_batch_job",
  async (job) => {
    const { orderIds } = job.data as { orderIds: string[] };
    if (!orderIds?.length) return;

    // Fetch all orders in this batch (include ebay_account for playwright_state fallback)
    const orders = await prisma.orders.findMany({
      where: { order_id: { in: orderIds } },
      include: { ebay_account: { select: { playwright_state: true } } }
    });

    // Determine session strategy
    const { existsSync } = await import("fs");
    const useProfileDir = existsSync(CHROME_PROFILE_DIR);

    let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
    let standaloneContext: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let page: import("playwright").Page;

    if (useProfileDir) {
      browser = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
        headless: true,
        args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
      });
      page = await browser.newPage();
    } else {
      // Fall back to playwright_state from DB
      const playwrightState = orders[0]?.ebay_account?.playwright_state;
      if (!playwrightState) {
        await prisma.orders.updateMany({
          where: { order_id: { in: orderIds }, original_total: null },
          data: {
            scrape_state: "NEEDS_LOGIN",
            scrape_attempts: { increment: 1 },
            last_scraped_at: new Date()
          }
        });
        throw new Error("No session available. Set up a Chrome profile or capture playwright_state via /dev page.");
      }
      standaloneContext = await chromium.launch({
        headless: true,
        args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
      });
      const ctx = await standaloneContext.newContext({
        storageState: JSON.parse(playwrightState)
      });
      page = await ctx.newPage();
    }

    let needsLogin = false;

    try {

      for (const order of orders) {
        if (order.original_total != null) {
          // Already set — just mark done
          await prisma.orders.update({
            where: { order_id: order.order_id },
            data: { scrape_state: "DONE" }
          });
          continue;
        }

        const url = `https://order.ebay.com/ord/show?orderId=${order.order_id}`;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

          // Detect login wall — eBay redirects to signin if session expired
          if (page.url().includes("signin") || page.url().includes("login")) {
            needsLogin = true;
            // Mark remaining orders and abort the batch
            await prisma.orders.updateMany({
              where: { order_id: { in: orderIds }, original_total: null },
              data: {
                scrape_state: "NEEDS_LOGIN",
                scrape_attempts: { increment: 1 },
                last_scraped_at: new Date()
              }
            });
            break;
          }

          // Wait for the order info section to be present
          await page.waitForSelector("dl[data-testid], .order-info, [class*='order']", {
            timeout: 10000
          }).catch(() => {});

          // ── Extract refund amounts ──────────────────────────────────────────
          // Primary: targeted selector for refund banner text
          // "You got a refund! A total of $1,400.30 was sent on Jan 29, 2026."
          let totalRefunds = 0;

          const refundBannerTexts = await page.evaluate(() => {
            // Look for elements containing "was sent" near a dollar amount
            const all = Array.from(document.querySelectorAll("*"));
            return all
              .filter(el =>
                el.children.length === 0 && // leaf nodes only
                /A total of \$[\d,]+\.\d{2} was sent/i.test(el.textContent ?? "")
              )
              .map(el => el.textContent ?? "");
          });

          for (const text of refundBannerTexts) {
            const m = text.match(/A total of \$([\d,]+\.\d{2})/i);
            if (m) totalRefunds += parseFloat(m[1].replace(/,/g, ""));
          }

          // Fallback: scan innerText of entire page for the pattern
          if (totalRefunds === 0) {
            const bodyText = await page.evaluate(() => document.body.innerText);
            for (const m of bodyText.matchAll(/A total of \$([\d,]+\.\d{2})\s*was sent/gi)) {
              totalRefunds += parseFloat(m[1].replace(/,/g, ""));
            }
            // Second fallback: "Refund $X.XX" line in payment summary
            if (totalRefunds === 0) {
              for (const m of bodyText.matchAll(/\bRefund\b[^\n]{0,40}\$([\d,]+\.\d{2})/gi)) {
                totalRefunds += parseFloat(m[1].replace(/,/g, ""));
              }
            }
          }

          // ── Compute and save original_total ────────────────────────────────
          const currentTotal = order.totals &&
            typeof order.totals === "object" &&
            "total" in order.totals
              ? parseFloat(String((order.totals as any).total))
              : null;

          if (currentTotal != null) {
            const originalTotal = parseFloat((currentTotal + totalRefunds).toFixed(2));
            await prisma.orders.update({
              where: { order_id: order.order_id },
              data: {
                original_total: originalTotal,
                scrape_state: "DONE",
                scrape_attempts: { increment: 1 },
                last_scraped_at: new Date()
              }
            });
          } else {
            await prisma.orders.update({
              where: { order_id: order.order_id },
              data: {
                scrape_state: "FAILED",
                scrape_attempts: { increment: 1 },
                last_scraped_at: new Date()
              }
            });
          }

          // Brief pause between pages to avoid rate-limiting
          await page.waitForTimeout(800);

        } catch (pageErr) {
          console.error(`order_scrape: failed for ${order.order_id}:`, pageErr);
          await prisma.orders.update({
            where: { order_id: order.order_id },
            data: {
              scrape_state: "FAILED",
              scrape_attempts: { increment: 1 },
              last_scraped_at: new Date()
            }
          });
        }
      }
    } finally {
      if (browser) await browser.close();
      if (standaloneContext) await standaloneContext.close();
    }

    if (needsLogin) {
      throw new Error("eBay session expired — login required. Use the /dev page to re-authenticate.");
    }
  },
  { connection: connection as any, concurrency: 1 }
);

async function scheduleRepeatableJobs() {
  const syncQueue = new Queue("sync_orders_job", { connection: connection as any });
  const alertsQueue = new Queue("alerts_job", { connection: connection as any });
  await syncQueue.add(
    "sync",
    {},
    {
      repeat: { every: 30 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10
    }
  );
  await alertsQueue.add(
    "alerts",
    {},
    {
      repeat: { every: 60 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10
    }
  );
}

scheduleRepeatableJobs().catch((error) => {
  console.error("Failed to schedule repeatable jobs", error);
});

syncOrdersWorker.on("failed", (job, err) => {
  console.error("sync_orders_job failed", job?.id, err);
});
enrichListingWorker.on("failed", (job, err) => {
  console.error("enrich_listing_job failed", job?.id, err);
});
returnsWorker.on("failed", (job, err) => {
  console.error("returns_scrape_job failed", job?.id, err);
});
reconcileWorker.on("failed", (job, err) => {
  console.error("reconcile_auction_job failed", job?.id, err);
});
snipeWorker.on("failed", (job, err) => {
  console.error("snipe_job failed", job?.id, err);
});
alertsWorker.on("failed", (job, err) => {
  console.error("alerts_job failed", job?.id, err);
});
