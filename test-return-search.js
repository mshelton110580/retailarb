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
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

async function main() {
  const acct = await prisma.ebay_accounts.findFirst();
  if (!acct) { console.log('NO_ACCOUNT'); return; }
  
  const token = decrypt(acct.token_encrypted);
  console.log('Token length:', token.length);
  
  const headers = {
    'Authorization': `IAF ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
  };
  
  // Test 1: With role=BUYER
  console.log('\n--- Test 1: role=BUYER ---');
  const url1 = 'https://api.ebay.com/post-order/v2/return/search?creation_date_range_from=2026-01-01T00:00:00.000Z&creation_date_range_to=2026-02-12T00:00:00.000Z&role=BUYER&limit=10&offset=0';
  const res1 = await fetch(url1, { headers });
  console.log('Status:', res1.status);
  const body1 = await res1.text();
  console.log('Body:', body1.substring(0, 500));
  
  // Test 2: Without role parameter
  console.log('\n--- Test 2: No role ---');
  const url2 = 'https://api.ebay.com/post-order/v2/return/search?creation_date_range_from=2026-01-01T00:00:00.000Z&creation_date_range_to=2026-02-12T00:00:00.000Z&limit=10&offset=0';
  const res2 = await fetch(url2, { headers });
  console.log('Status:', res2.status);
  const body2 = await res2.text();
  console.log('Body:', body2.substring(0, 500));
  
  // Test 3: Minimal - no date range
  console.log('\n--- Test 3: Minimal ---');
  const url3 = 'https://api.ebay.com/post-order/v2/return/search?limit=10&offset=0';
  const res3 = await fetch(url3, { headers });
  console.log('Status:', res3.status);
  const body3 = await res3.text();
  console.log('Body:', body3.substring(0, 500));
  
  // Test 4: role=BUYER, shorter date range
  console.log('\n--- Test 4: role=BUYER, last 7 days ---');
  const url4 = 'https://api.ebay.com/post-order/v2/return/search?creation_date_range_from=2026-02-05T00:00:00.000Z&creation_date_range_to=2026-02-12T00:00:00.000Z&role=BUYER&limit=10&offset=0';
  const res4 = await fetch(url4, { headers });
  console.log('Status:', res4.status);
  const body4 = await res4.text();
  console.log('Body:', body4.substring(0, 500));
  
  await prisma.$disconnect();
}

main().catch(console.error);
