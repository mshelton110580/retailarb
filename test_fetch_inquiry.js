const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const { Client } = require('pg');

// Load env
const envContent = fs.readFileSync('/opt/retailarb/.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, '$1');
});

function decrypt(payload) {
  // Key: first 32 chars as raw bytes (not hex)
  const key = Buffer.from(env.ENCRYPTION_KEY.slice(0, 32));
  const raw = Buffer.from(payload, 'base64');
  // Format: [iv(12)][authTag(16)][ciphertext]
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function apiCall(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.ebay.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': 'IAF ' + token,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      }
    };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: resp.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let token;

async function main() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const res = await client.query('SELECT token_encrypted FROM ebay_accounts LIMIT 1');
  token = decrypt(res.rows[0].token_encrypted);
  await client.end();
  console.log('Token decrypted, length:', token.length);

  // 1. Try fetching inquiry 5372055711 directly
  console.log('\n=== GET /post-order/v2/inquiry/5372055711 ===');
  const r1 = await apiCall('/post-order/v2/inquiry/5372055711');
  console.log('Status:', r1.status);
  console.log(JSON.stringify(r1.body, null, 2));

  // 2. Search by item_id
  console.log('\n=== Search by item_id 116760271073 ===');
  const r2 = await apiCall('/post-order/v2/inquiry/search?item_id=116760271073&fieldgroups=FULL');
  console.log('Status:', r2.status);
  console.log(JSON.stringify(r2.body, null, 2));

  // 3. Also check if it's a case (not inquiry) via the case API
  console.log('\n=== GET /post-order/v2/casemanagement/5372055711 ===');
  const r3 = await apiCall('/post-order/v2/casemanagement/5372055711');
  console.log('Status:', r3.status);
  console.log(JSON.stringify(r3.body, null, 2));
}

main().catch(console.error);
