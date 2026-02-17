import { prisma } from "../src/lib/db";

async function main() {
  console.log("Creating category_merges table...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "category_merges" (
        "id" TEXT NOT NULL,
        "from_category_name" TEXT NOT NULL,
        "to_category_id" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_by" TEXT,

        CONSTRAINT "category_merges_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "category_merges_from_category_name_key"
    ON "category_merges"("from_category_name");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "category_merges_to_category_id_idx"
    ON "category_merges"("to_category_id");
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'category_merges_to_category_id_fkey'
      ) THEN
        ALTER TABLE "category_merges"
        ADD CONSTRAINT "category_merges_to_category_id_fkey"
        FOREIGN KEY ("to_category_id") REFERENCES "item_categories"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  console.log("✓ category_merges table created successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
