-- Add transaction_id and order_line_item_id to order_items
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "transaction_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "order_line_item_id" TEXT;
