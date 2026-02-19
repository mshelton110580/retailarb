-- CreateEnum
CREATE TYPE "OrderScrapeState" AS ENUM ('PENDING', 'DONE', 'NEEDS_LOGIN', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "scrape_state" "OrderScrapeState",
ADD COLUMN "scrape_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_scraped_at" TIMESTAMP(3);
