# ArbDesk

ArbDesk is a full-stack retail arbitrage workspace for eBay buyers. It provides targets/sniping, order sync via eBay Trading API, inventory dashboards, receiving workflows, and a returns-only scraper built on Playwright.

## Tech Stack
- Next.js (App Router) + Tailwind
- NextAuth (Credentials) with RBAC roles
- Postgres + Prisma
- BullMQ + Redis
- Playwright (returns-only scraping)
- Local filesystem storage with an abstraction for future S3/R2 support

## Local Development (Docker)

0. Clone the repository:
   ```bash
   git clone https://github.com/mshelton110580/retailarb.git
   cd retailarb
   ```

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

2. Start services:
   ```bash
   docker compose up --build
   ```

3. Run migrations:
   ```bash
   docker compose exec app npm run prisma:migrate
   ```

4. Seed the admin user:
   ```bash
   docker compose exec app npm run seed
   ```

5. Visit the app at http://localhost:3000

## Environment Variables

See `.env.example` for all variables. Key settings:

- `DATABASE_URL`, `REDIS_URL`
- `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` (32+ bytes)
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`
- `STORAGE_PATH` for images and return labels
- `FEATURE_OFFER_API`, `FEATURE_PLACE_OFFER`
- `PLAYWRIGHT_HEADLESS`

## Background Jobs

- `sync_orders_job`: sync orders for the last 30 days (repeat every 30 min).
- `enrich_listing_job`: enrich target listings via Browse API.
- `snipe_job`: scheduled at `end_time - lead_seconds`.
- `reconcile_auction_job`: marks win/loss after auction end.
- `returns_scrape_job`: returns status and label scraping.
- `alerts_job`: checks late/not delivered items.

The worker container runs BullMQ processors and registers repeatable jobs on startup.

## Production Deployment Notes

1. Deploy the `app` and `worker` containers behind Cloudflare on a subdomain such as `arbdesk.example.com`.
2. Point Cloudflare DNS to your container host (reverse proxy or tunnel).
3. Set `EBAY_REDIRECT_URI` to `https://arbdesk.example.com/api/auth/ebay/callback`.
4. Use persistent volumes for Postgres and `STORAGE_PATH`.
5. Ensure Playwright dependencies are available for the worker container.

## eBay API Notes

- Trading API calls use OAuth access tokens via `X-EBAY-API-IAF-TOKEN`.
- Orders are synced only via `GetOrders` and used to derive shipping status.
- Returns are manual filing with scraping for status/label only (no Post-Order API).
- Listing enrichment uses the Browse API.

## Manual Acceptance Checklist

- Admin can log in and create users.
- eBay account connects; callback works.
- Sync orders pulls orders with tracking and delivered timestamps.
- Derived shipping status matches expectations.
- Targets persist and show statuses; listing enrichment runs.
- Snipes schedule and record attempted; reconcile marks win/loss.
- Receiving scan matches by last 8 digits; requires photos for non-good.
- Returns: user opens order, marks return filed, scraper captures status and downloads label.

## Project Structure

- `src/app`: Next.js App Router pages and API routes
- `src/lib`: DB, auth, eBay clients, crypto, queue utilities
- `src/worker`: BullMQ processors and Playwright returns scraper
- `prisma`: Prisma schema, migrations, seed
