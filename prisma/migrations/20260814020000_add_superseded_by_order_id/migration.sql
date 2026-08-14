-- Additive: mark legacy composite-id duplicate orders as superseded by their modern twin
ALTER TABLE "orders" ADD COLUMN "superseded_by_order_id" TEXT;
