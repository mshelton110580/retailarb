import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

export const queues = {
  syncOrders: new Queue("sync_orders_job", { connection }),
  enrichListing: new Queue("enrich_listing_job", { connection }),
  snipe: new Queue("snipe_job", { connection }),
  reconcileAuction: new Queue("reconcile_auction_job", { connection }),
  returnsScrape: new Queue("returns_scrape_job", { connection }),
  alerts: new Queue("alerts_job", { connection })
};

export type QueueName = keyof typeof queues;
