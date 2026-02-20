/**
 * ebay-login.js
 *
 * One-time login script to establish a persistent Chrome profile for eBay scraping.
 * Run this on the server (with a display) or locally with X11 forwarding.
 *
 * Usage:
 *   cd /opt/retailarb
 *   node scripts/ebay-login.js
 *
 * What it does:
 *   1. Opens a visible Chromium browser to https://www.ebay.com/signin
 *   2. Waits up to 3 minutes for you to sign in manually
 *   3. Once signed in, saves the Chrome profile to /opt/retailarb/chrome-profile
 *   4. The worker uses this profile for all future headless scraping
 *
 * After this runs once, you never need to run it again unless eBay invalidates
 * the session (which is rare with persistent profiles).
 *
 * Environment variable:
 *   EBAY_CHROME_PROFILE=/path/to/profile  (default: /opt/retailarb/chrome-profile)
 */

const { chromium } = require("playwright");
const path = require("path");

const PROFILE_DIR = process.env.EBAY_CHROME_PROFILE ?? path.join(__dirname, "../chrome-profile");

async function main() {
  console.log(`Opening browser with profile: ${PROFILE_DIR}`);
  console.log("Sign in to eBay in the browser that opens. Close it when done.\n");

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.goto("https://www.ebay.com/signin", { waitUntil: "domcontentloaded" });

  console.log("=================================================");
  console.log("ACTION: Sign in to eBay, then close the browser.");
  console.log("Waiting up to 3 minutes...");
  console.log("=================================================\n");

  // Wait until the user navigates away from sign-in (completed login)
  try {
    await page.waitForFunction(
      () => !window.location.href.includes("signin") && !window.location.href.includes("login"),
      { timeout: 180000, polling: 2000 }
    );
    console.log("Sign-in detected. Navigating to orders to verify...");
    await page.goto("https://order.ebay.com/ord/list", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("signin") || page.url().includes("login")) {
      console.error("Session doesn't appear valid — still on login page.");
    } else {
      console.log(`Session valid. Profile saved to: ${PROFILE_DIR}`);
      console.log("You can now run the scrape from the /dev page.");
    }
  } catch {
    console.log("Timed out or browser closed early. Profile state saved as-is.");
  }

  await browser.close();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
