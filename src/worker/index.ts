import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../lib/db";
import { getItemByLegacyId } from "../lib/ebay/browse";
import { getValidAccessToken } from "../lib/ebay/token";
import { saveFile } from "../lib/storage";
import { chromium } from "playwright";
import { placeProxyBid } from "../lib/ebay/offer";
import { syncOrders } from "../app/api/orders/sync/route";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

const syncOrdersWorker = new Worker(
  "sync_orders_job",
  async (job) => {
    await syncOrders(job.data.ebayAccountId);
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
