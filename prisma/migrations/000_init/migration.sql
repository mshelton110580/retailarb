-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RECEIVER', 'VIEWER');
CREATE TYPE "TargetType" AS ENUM ('AUCTION', 'BIN', 'BEST_OFFER');
CREATE TYPE "TargetStatus" AS ENUM ('TARGETED', 'SNIPE_SCHEDULED', 'BID_ATTEMPTED', 'WON', 'LOST_OUTBID', 'ENDED_NO_WIN', 'PURCHASED', 'CANCELED', 'EXPIRED');
CREATE TYPE "ResolutionState" AS ENUM ('UNRESOLVED', 'MATCHED', 'DISMISSED');
CREATE TYPE "ReturnScrapeState" AS ENUM ('PENDING', 'ACTIVE', 'NEEDS_LOGIN', 'COMPLETE', 'FAILED');

CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ebay_accounts" (
  "id" TEXT PRIMARY KEY,
  "owner_user_id" TEXT NOT NULL,
  "ebay_username" TEXT NOT NULL,
  "token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT NOT NULL,
  "token_expiry" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT NOT NULL,
  "playwright_state" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_sync_at" TIMESTAMP(3),
  CONSTRAINT "ebay_accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "targets" (
  "item_id" TEXT PRIMARY KEY,
  "ebay_account_id" TEXT,
  "type" "TargetType" NOT NULL,
  "max_snipe_bid" NUMERIC(12,2),
  "best_offer_amount" NUMERIC(12,2),
  "lead_seconds" INTEGER NOT NULL,
  "created_by" TEXT NOT NULL,
  "status" "TargetStatus" NOT NULL,
  "status_history" JSONB NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "targets_ebay_account_id_fkey" FOREIGN KEY ("ebay_account_id") REFERENCES "ebay_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "listings" (
  "item_id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "end_time" TIMESTAMP(3),
  "current_price" NUMERIC(12,2),
  "shipping_estimate" NUMERIC(12,2),
  "buying_options" JSONB,
  "raw_json" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "targets"("item_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "orders" (
  "order_id" TEXT PRIMARY KEY,
  "ebay_account_id" TEXT NOT NULL,
  "purchase_date" TIMESTAMP(3) NOT NULL,
  "order_status" TEXT NOT NULL,
  "totals" JSONB NOT NULL,
  "ship_to_city" TEXT,
  "ship_to_state" TEXT,
  "ship_to_postal" TEXT,
  "order_url" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_ebay_account_id_fkey" FOREIGN KEY ("ebay_account_id") REFERENCES "ebay_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "order_items" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "transaction_price" NUMERIC(12,2) NOT NULL,
  "shipping_cost" NUMERIC(12,2),
  "final_price" NUMERIC(12,2),
  "purchase_date" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "targets"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "shipments" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "derived_status" TEXT NOT NULL,
  "estimated_min" TIMESTAMP(3),
  "estimated_max" TIMESTAMP(3),
  "scheduled_min" TIMESTAMP(3),
  "scheduled_max" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "last_refreshed_at" TIMESTAMP(3),
  CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "tracking_numbers" (
  "id" TEXT PRIMARY KEY,
  "shipment_id" TEXT NOT NULL,
  "carrier" TEXT,
  "tracking_number" TEXT NOT NULL,
  "status_text" TEXT,
  "last_seen_at" TIMESTAMP(3),
  CONSTRAINT "tracking_numbers_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "receiving_scans" (
  "id" TEXT PRIMARY KEY,
  "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scanned_by_user_id" TEXT NOT NULL,
  "tracking_last8" TEXT NOT NULL,
  "resolution_state" "ResolutionState" NOT NULL,
  "notes" TEXT,
  CONSTRAINT "receiving_scans_scanned_by_user_id_fkey" FOREIGN KEY ("scanned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "received_units" (
  "id" TEXT PRIMARY KEY,
  "item_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "unit_index" INTEGER NOT NULL,
  "condition_status" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scanned_by_user_id" TEXT NOT NULL,
  "notes" TEXT,
  CONSTRAINT "received_units_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "listings"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "received_units_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "received_units_scanned_by_user_id_fkey" FOREIGN KEY ("scanned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "unit_images" (
  "id" TEXT PRIMARY KEY,
  "received_unit_id" TEXT NOT NULL,
  "image_path" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_images_received_unit_id_fkey" FOREIGN KEY ("received_unit_id") REFERENCES "received_units"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "lots" (
  "id" TEXT PRIMARY KEY,
  "item_id" TEXT NOT NULL,
  "expected_unit_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "listings"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "lot_units" (
  "id" TEXT PRIMARY KEY,
  "lot_id" TEXT NOT NULL,
  "unit_index" INTEGER NOT NULL,
  "received_unit_id" TEXT,
  CONSTRAINT "lot_units_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lot_units_received_unit_id_fkey" FOREIGN KEY ("received_unit_id") REFERENCES "received_units"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "returns" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "item_id" TEXT,
  "filed_manually_at" TIMESTAMP(3),
  "status_scraped" TEXT,
  "label_pdf_path" TEXT,
  "last_scraped_at" TIMESTAMP(3),
  "next_scrape_at" TIMESTAMP(3),
  "scrape_attempts" INTEGER NOT NULL DEFAULT 0,
  "scrape_state" "ReturnScrapeState" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "returns_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "listings"("item_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "inr_cases" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "item_id" TEXT,
  "filed_manually_at" TIMESTAMP(3),
  "status_text" TEXT,
  "notes" TEXT,
  CONSTRAINT "inr_cases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inr_cases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "listings"("item_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "condition_templates" (
  "id" TEXT PRIMARY KEY,
  "condition_status" TEXT NOT NULL,
  "return_message_template" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "audit_log" (
  "id" TEXT PRIMARY KEY,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
