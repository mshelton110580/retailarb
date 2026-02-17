/**
 * Manually trigger inventory state updates from returns
 */

import { updateInventoryStatesFromReturns } from "../src/lib/inventory-transitions";

async function main() {
  console.log("Running inventory state updates...");
  await updateInventoryStatesFromReturns();
  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
