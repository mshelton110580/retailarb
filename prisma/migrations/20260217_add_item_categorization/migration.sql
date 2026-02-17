-- Add GTIN and product identifiers to listings
ALTER TABLE "listings" ADD COLUMN "gtin" TEXT;
ALTER TABLE "listings" ADD COLUMN "brand" TEXT;
ALTER TABLE "listings" ADD COLUMN "mpn" TEXT;

-- Create item_categories table for GTIN-based grouping
CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "gtin" TEXT,
    "category_name" TEXT NOT NULL,
    "category_keywords" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- Add unique constraint on GTIN
CREATE UNIQUE INDEX "item_categories_gtin_key" ON "item_categories"("gtin");

-- Add inventory state and category tracking to received_units
ALTER TABLE "received_units" ADD COLUMN "inventory_state" TEXT NOT NULL DEFAULT 'on_hand';
ALTER TABLE "received_units" ADD COLUMN "category_id" TEXT;

-- Add foreign key for category
ALTER TABLE "received_units" ADD CONSTRAINT "received_units_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
