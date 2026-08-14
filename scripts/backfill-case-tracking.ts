// One-time backfill: fetch eBay case detail for returns linked to cases and copy
// ship-back tracking onto the return where missing. Reads eBay; writes only
// returns.return_tracking_number/return_carrier when currently null.
import { prisma } from "../src/lib/db";
import { getValidAccessToken } from "../src/lib/ebay/token";
import { getCaseDetail, extractCaseTracking } from "../src/lib/ebay/post-order";

async function main() {
  const account = await prisma.ebay_accounts.findFirst({ select: { id: true } });
  if (!account) throw new Error("no ebay account");
  const { token } = await getValidAccessToken(account.id);

  const linked = await prisma.returns.findMany({
    where: { case_id: { not: null }, return_tracking_number: null },
    select: { id: true, ebay_return_id: true, case_id: true, order_id: true }
  });
  console.log(`linked returns without tracking: ${linked.length}`);

  let updated = 0;
  for (const r of linked) {
    const detail = await getCaseDetail(token, r.case_id!);
    const trk = extractCaseTracking(detail);
    if (trk) {
      await prisma.returns.update({
        where: { id: r.id },
        data: { return_tracking_number: trk.trackingNumber, return_carrier: trk.carrier, return_tracking_status: trk.currentStatus }
      });
      updated++;
      console.log(`  return ${r.ebay_return_id} (order ${r.order_id}) <- case ${r.case_id}: ${trk.carrier ?? "?"} ${trk.trackingNumber} (${trk.currentStatus ?? "status unknown"})`);
    }
  }
  console.log(`updated ${updated} of ${linked.length}`);
}

main().finally(() => prisma.$disconnect());
