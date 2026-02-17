import { prisma } from "../src/lib/db";

async function main() {
  const categories = await prisma.item_categories.findMany({
    select: {
      id: true,
      category_name: true,
      gtin: true
    },
    orderBy: { category_name: 'asc' }
  });

  console.log("=== All Categories ===");
  console.log(`Total: ${categories.length}`);
  console.log();

  // Group by normalized name (lowercase, trimmed)
  const grouped = new Map<string, typeof categories>();
  for (const cat of categories) {
    const normalized = cat.category_name.toLowerCase().trim();
    if (!grouped.has(normalized)) {
      grouped.set(normalized, []);
    }
    grouped.get(normalized)!.push(cat);
  }

  console.log("=== Duplicates (case-insensitive) ===");
  let duplicateCount = 0;
  for (const [name, cats] of grouped.entries()) {
    if (cats.length > 1) {
      duplicateCount++;
      console.log(`"${name}" - ${cats.length} entries:`);
      for (const c of cats) {
        console.log(`  - ${c.category_name} (GTIN: ${c.gtin || 'none'}) [${c.id}]`);
      }
      console.log();
    }
  }

  console.log(`\nFound ${duplicateCount} duplicate category names`);
  console.log(`Unique categories: ${grouped.size}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
