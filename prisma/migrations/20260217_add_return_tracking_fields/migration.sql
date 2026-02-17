-- Add return tracking fields to returns table
ALTER TABLE "returns" ADD COLUMN "return_carrier" TEXT;
ALTER TABLE "returns" ADD COLUMN "return_tracking_number" TEXT;
ALTER TABLE "returns" ADD COLUMN "return_tracking_status" TEXT;
ALTER TABLE "returns" ADD COLUMN "return_shipped_date" TIMESTAMP(3);
ALTER TABLE "returns" ADD COLUMN "return_delivered_date" TIMESTAMP(3);
ALTER TABLE "returns" ADD COLUMN "label_created_date" TIMESTAMP(3);
ALTER TABLE "returns" ADD COLUMN "label_url" TEXT;
ALTER TABLE "returns" ADD COLUMN "label_created_by" TEXT;
ALTER TABLE "returns" ADD COLUMN "refund_issued_date" TIMESTAMP(3);
