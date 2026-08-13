// Read-only check: run the shared planner against the dev DB and report the
// transition mix. Does NOT call applyInventoryTransitions — no writes.
// Run: npx ts-node --transpile-only -r tsconfig-paths/register -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-transition-planner.ts
import { planInventoryTransitions } from "../src/lib/inventory-transitions";
import { prisma } from "../src/lib/db";

async function main() {
  const plan = await planInventoryTransitions();

  const counts = new Map<string, number>();
  for (const t of plan) {
    const key = `${t.from} -> ${t.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log("Planned transitions by from -> to:");
  for (const [key, count] of sorted) {
    console.log(`  ${key}: ${count}`);
  }
  console.log(`\nTotal planned transitions: ${plan.length}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
