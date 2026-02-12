const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function decrypt(payload) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY.slice(0, 32));
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

(async () => {
  const acct = await prisma.ebay_accounts.findFirst();
  const token = decrypt(acct.token_encrypted);

  const url = 'https://api.ebay.com/post-order/v2/return/search?creation_date_range_from=2025-11-14T00:00:00.000Z&creation_date_range_to=2026-02-12T23:59:59.000Z&role=BUYER&limit=200&offset=0';
  const res = await fetch(url, {
    headers: {
      'Authorization': 'IAF ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    }
  });
  const body = await res.json();

  let hasActual = 0;
  let onlyEstimated = 0;
  let noRefund = 0;

  for (const m of body.members) {
    const actual = m.buyerTotalRefund && m.buyerTotalRefund.actualRefundAmount;
    const estimated = m.buyerTotalRefund && m.buyerTotalRefund.estimatedRefundAmount;
    if (actual) {
      hasActual++;
    } else if (estimated) {
      onlyEstimated++;
    } else {
      noRefund++;
    }
  }

  console.log('Total:', body.members.length);
  console.log('Has actualRefundAmount:', hasActual);
  console.log('Only estimatedRefundAmount:', onlyEstimated);
  console.log('No refund info:', noRefund);

  // Show the ones with only estimated (not actually refunded)
  console.log('\n--- Returns with only estimated (not actually refunded) ---');
  for (const m of body.members) {
    const actual = m.buyerTotalRefund && m.buyerTotalRefund.actualRefundAmount;
    const estimated = m.buyerTotalRefund && m.buyerTotalRefund.estimatedRefundAmount;
    if (!actual && estimated) {
      console.log('returnId:', m.returnId, 'state:', m.state, 'status:', m.status);
    }
  }

  await prisma.$disconnect();
})();
