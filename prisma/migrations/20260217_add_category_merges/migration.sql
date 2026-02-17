-- CreateTable
CREATE TABLE IF NOT EXISTS "category_merges" (
    "id" TEXT NOT NULL,
    "from_category_name" TEXT NOT NULL,
    "to_category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "category_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_merges_from_category_name_key" ON "category_merges"("from_category_name");

-- CreateIndex
CREATE INDEX "category_merges_to_category_id_idx" ON "category_merges"("to_category_id");

-- AddForeignKey
ALTER TABLE "category_merges" ADD CONSTRAINT "category_merges_to_category_id_fkey" FOREIGN KEY ("to_category_id") REFERENCES "item_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
