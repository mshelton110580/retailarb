-- AlterTable
ALTER TABLE "returns" ADD COLUMN "case_id" TEXT;

-- CreateTable
CREATE TABLE "inventory_state_snapshots" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "inventory_state" TEXT NOT NULL,
    "batch_label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_state_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_state_snapshots_batch_label_idx" ON "inventory_state_snapshots"("batch_label");
