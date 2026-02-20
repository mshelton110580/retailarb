/**
 * capture-ebay-session.js
 *
 * Run this script on your LOCAL machine (not the server) to capture an eBay
 * browser session and save it to the production database.
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   APP_URL=https://your-app.com ACCOUNT_ID=<ebay_account_id> node scripts/capture-ebay-session.js
 *
 * What it does:
 *   1. Opens a visible Chrome browser to https://www.ebay.com/signin
 *   2. Waits for you to sign in manually (you have 2 minutes)
 *   3. Navigates to the orders page to confirm the session is valid
 *   4. Saves the session (cookies + localStorage) to the app via PATCH /api/ebay-accounts
 *
 * After this runs successfully, go to /dev and click "Start Scrape".
 */

const { chromium } = require("playwright");
const https = require("https");
const http = require("http");

const APP_URL = process.env.APP_URL;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const SESSION_COOKIE = process.env.SESSION_COOKIE; // arbdesk session cookie for auth

if (!APP_URL) {
  console.error("Error: APP_URL environment variable is required");
  console.error("  Example: APP_URL=https://68.183.121.176:3000 ACCOUNT_ID=xxx SESSION_COOKIE=xxx node scripts/capture-ebay-session.js");
  process.exit(1);
}
if (!ACCOUNT_ID) {
  console.error("Error: ACCOUNT_ID environment variable is required");
  console.error("  Find it by checking the /ebay-accounts page or the DB: SELECT id, ebay_username FROM ebay_accounts;");
  process.exit(1);
}
if (!SESSION_COOKIE) {
  console.error("Error: SESSION_COOKIE environment variable is required");
  console.error("  Log into the app in your browser, open DevTools > Application > Cookies and copy the value of 'next-auth.session-token'");
  process.exit(1);
}

async function main() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Opening eBay sign-in page...");
  await page.goto("https://www.ebay.com/signin", { waitUntil: "domcontentloaded" });

  console.log("\n=================================================");
  console.log("ACTION REQUIRED: Sign in to eBay in the browser.");
  console.log("You have 2 minutes. The script continues automatically after sign-in.");
  console.log("=================================================\n");

  // Wait until we're no longer on a signin page (user completed login)
  try {
    await page.waitForFunction(
      () => !window.location.href.includes("signin") && !window.location.href.includes("login"),
      { timeout: 120000, polling: 2000 }
    );
  } catch {
    console.error("Timed out waiting for sign-in. Please run the script again.");
    await browser.close();
    process.exit(1);
  }

  console.log("Sign-in detected. Navigating to orders to verify session...");
  await page.goto("https://www.ebay.com/mye/myebay/purchase", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes("signin") || url.includes("login")) {
    console.error("Session doesn't appear valid — still on login page. Please try again.");
    await browser.close();
    process.exit(1);
  }

  console.log("Session verified. Saving storage state...");
  const storageState = await context.storageState();
  const storageStateJson = JSON.stringify(storageState);

  console.log(`  Cookies captured: ${storageState.cookies.length}`);
  console.log(`  Origins captured: ${storageState.origins.length}`);

  await browser.close();
  console.log("Browser closed.");

  // POST to app
  console.log(`\nSaving session to app at ${APP_URL}...`);
  const payload = JSON.stringify({ playwright_state: storageStateJson });

  const appUrl = new URL(`/api/ebay-accounts?id=${ACCOUNT_ID}`, APP_URL);
  const isHttps = appUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: appUrl.hostname,
        port: appUrl.port || (isHttps ? 443 : 80),
        path: appUrl.pathname + appUrl.search,
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "Cookie": `next-auth.session-token=${SESSION_COOKIE}`
        },
        rejectUnauthorized: false // allow self-signed certs for dev
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log("Session saved successfully.");
            console.log("Go to /dev and click 'Start Scrape' to begin the backfill.");
            resolve(undefined);
          } else {
            console.error(`App returned status ${res.statusCode}: ${body}`);
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
