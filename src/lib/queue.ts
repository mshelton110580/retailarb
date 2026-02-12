import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

export const queues = {
  syncOrders: new Queue("sync_orders_job", { connection: connection as any }),
  enrichListing: new Queue("enrich_listing_job", { connection: connection as any }),
  snipe: new Queue("snipe_job", { connection: connection as any }),
  reconcileAuction: new Queue("reconcile_auction_job", { connection: connection as any }),
  returnsScrape: new Queue("returns_scrape_job", { connection: connection as any }),
  alerts: new Queue("alerts_job", { connection: connection as any })
};

export type QueueName = keyof typeof queues;
