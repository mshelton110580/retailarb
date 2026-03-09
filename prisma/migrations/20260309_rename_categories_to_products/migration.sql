-- Rename "category" to "product" throughout the schema.
-- Avoids future naming conflict with eBay's own category system.
-- All ALTER TABLE RENAME operations are atomic in PostgreSQL.

-- Rename tables
ALTER TABLE "item_categories" RENAME TO "products";
ALTER TABLE "category_merges" RENAME TO "product_aliases";

-- Rename columns on products (formerly item_categories)
ALTER TABLE "products" RENAME COLUMN "category_name" TO "product_name";
ALTER TABLE "products" RENAME COLUMN "category_keywords" TO "product_keywords";

-- Rename columns on product_aliases (formerly category_merges)
ALTER TABLE "product_aliases" RENAME COLUMN "from_category_name" TO "from_product_name";
ALTER TABLE "product_aliases" RENAME COLUMN "to_category_id" TO "to_product_id";

-- Rename column on received_units
ALTER TABLE "received_units" RENAME COLUMN "category_id" TO "product_id";

-- Rename indexes (PostgreSQL keeps old index names after table rename)
ALTER INDEX "category_merges_pkey" RENAME TO "product_aliases_pkey";
ALTER INDEX "category_merges_from_category_name_key" RENAME TO "product_aliases_from_product_name_key";
ALTER INDEX "category_merges_to_category_id_idx" RENAME TO "product_aliases_to_product_id_idx";

-- Rename foreign key constraints
ALTER TABLE "product_aliases" RENAME CONSTRAINT "category_merges_to_category_id_fkey" TO "product_aliases_to_product_id_fkey";
ALTER TABLE "received_units" RENAME CONSTRAINT "received_units_category_id_fkey" TO "received_units_product_id_fkey";
