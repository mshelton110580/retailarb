# ArbDesk - eBay Retail Arbitrage Workspace

## Quick Reference

- **Stack**: Next.js 14 + TypeScript + Prisma + PostgreSQL 15 + Redis + BullMQ
- **Dev**: `/opt/retailarb-dev/` -- branch `arbdesk-dev`, port 3002, DB `arbdesk_dev`
- **Staging**: `/opt/retailarb-staging/` -- branch `staging`, port 3001, DB `arbdesk_staging`
- **Production**: `/opt/retailarb/` -- branch `main`, port 3000, DB `arbdesk`
- **GitHub**: `mshelton110580/retailarb` (PAT auth via git remote)
- **URLs**: `arbdesk.sheltonpropertiesllc.com` (prod), `staging.` (staging), `dev.` (dev) -- all via Cloudflare tunnel

## IMPORTANT: Code Change Workflow

- **ALL code changes happen on the dev branch** (`/opt/retailarb-dev/`)
- **NEVER edit production or staging code directly** -- changes flow through the deploy pipeline
- `.env` files are the exception -- they are gitignored, permanent per-environment, and can be edited directly
- Deploy flow: commit on dev -> `./deploy.sh staging` -> test -> `./deploy.sh production`
- The deploy script must be run from `/opt/retailarb-dev/` (it has the current version)

## Architecture Overview

```
+-------------------------------+     +----------------------+
|  Next.js App (port 300x)      |     |  Worker (ts-node)    |
|  -- App Router pages          |     |  -- sync_orders (30m)|
|  -- API routes (/api/*)       |---->|  -- enrich_listing   |
|  -- Server components         |redis|  -- returns_scrape   |
+---------+---------------------+     |  -- snipe            |
          |                           |  -- reconcile_auction|
          | prisma                    |  -- alerts (60m)     |
+---------v---------------------+     +----------+-----------+
|  PostgreSQL 15                |                |
|  (arbdesk / arbdesk_dev / etc)|     +----------v-----------+
+-------------------------------+     |  eBay APIs           |
                                      |  -- Trading (orders) |
                                      |  -- Browse (enrich)  |
                                      |  -- Post-Order (ret) |
                                      |  -- Offer (bids)     |
                                      +----------------------+
```

## Project Structure

```
src/
-- app/                          # Next.js App Router
|   -- layout.tsx                # Root layout with nav bar + SignOutButton
|   -- page.tsx                  # Dashboard
|   -- login/                    # Auth login page
|   |   -- page.tsx              # Server component (redirects if already logged in)
|   |   -- login-form.tsx        # Client component (credentials form)
|   -- orders/                   # Order list, search, detail
|   |   -- page.tsx              # Simple order list with date filters
|   |   -- search/               # Advanced search with grid
|   |   |   -- page.tsx          # Server component wrapper
|   |   |   -- order-search.tsx  # Client component (virtualized table, ~1500 lines)
|   |   -- [orderId]/            # Order detail view
|   -- inventory/                # Dashboard with delivery/return status buckets
|   -- on-hand/                  # Per-product inventory with refund allocation
|   -- receiving/                # Warehouse scan workflows + CSV import
|   -- units/                    # Unit search/filter/bulk-edit table
|   -- returns/                  # Return request management
|   -- inr/                      # Item Not Received cases
|   -- targets/                  # Auction sniping targets
|   -- ebay-accounts/            # OAuth connection management
|   -- admin/                    # Users, categories, conditions
|   -- settings/                 # Feature flags
|   -- api/                      # 44 API endpoints (see below)
-- components/                   # 11 reusable components
|   -- sign-out-button.tsx       # Client component, calls signOut({ callbackUrl: "/login" })
-- lib/                          # Utilities and integrations
|   -- auth.ts                   # NextAuth config (JWT + credentials, pages.signIn: "/login")
|   -- db.ts                     # Prisma singleton
|   -- rbac.ts                   # Role-based access control
|   -- queue.ts                  # BullMQ queue definitions
|   -- crypto.ts                 # AES-256-GCM for eBay tokens
|   -- conditions.ts             # Condition constants (synced with DB)
|   -- shipping.ts               # Shipping status state machine
|   -- storage.ts                # File storage (local, S3-ready)
|   -- date-range.ts             # Server-side date filtering
|   -- inventory-transitions.ts  # Inventory state machine
|   -- item-categorization.ts    # Smart product categorization
|   -- tracking-search.ts        # Unified tracking number search (handles USPS barcodes, UPS, partials)
|   -- use-barcode-scanner.ts    # React hook: detects rapid keystrokes from barcode scanners
|   -- ebay/                     # eBay API wrappers
|       -- trading.ts            # GetOrders (XML-RPC)
|       -- post-order.ts         # Returns/INR/Cases (REST)
|       -- browse.ts             # Item enrichment (REST)
|       -- offer.ts              # Proxy bidding (REST)
|       -- oauth.ts              # OAuth code exchange
|       -- token.ts              # Token refresh
-- types/
|   -- next-auth.d.ts            # Session type augmentation
-- worker/
    -- index.ts                  # BullMQ job processors (guarded by DISABLE_EBAY_SYNC)
```

## Key API Endpoints

| Area | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| Orders | `/api/orders/search` | GET | Advanced search with filtering, sorting, pagination, per-item refund calc |
| Orders | `/api/orders/sync` | POST | Sync orders from eBay Trading API |
| Receiving | `/api/receiving/scan` | POST | Process warehouse barcode scan |
| Units | `/api/units` | GET | List/search units with virtual scrolling |
| Units | `/api/units/bulk` | PATCH | Bulk update units (state, category, condition) |
| Units | `/api/units/conditions` | GET | List all condition values from database |
| Returns | `/api/returns` | GET | List returns with filters |
| Returns | `/api/returns/refresh` | POST | Sync returns from eBay Post-Order API |
| Returns | `/api/returns/filed` | POST | File manual return |
| INR | `/api/inr` | GET | List INR cases |
| Sync | `/api/sync/all` | POST | Trigger all sync jobs |
| Targets | `/api/targets` | GET/POST | List/create auction targets |
| Auth | `/api/auth/ebay/callback` | GET | eBay OAuth redirect handler |
| Admin | `/api/admin/users` | GET/POST | User CRUD |

## Database Models (Prisma)

### Core Business Flow
1. **ebay_accounts** -- OAuth-connected eBay accounts (tokens encrypted with AES-256-GCM)
2. **targets** -- Items to monitor/snipe (AUCTION, BIN, BEST_OFFER)
3. **listings** -- eBay product metadata (title, GTIN, brand, MPN from Browse API)
4. **orders** -- Purchased eBay orders with immutable cost basis (`original_total`)
5. **order_items** -- Line items (qty, transaction_price, shipping_cost per item)
6. **shipments** + **tracking_numbers** -- Inbound delivery tracking
7. **received_units** -- Physical inventory (condition, inventory_state, category)
8. **returns** -- Return requests with actual_refund, ebay_item_id, tracking, label PDFs
9. **inr_cases** -- Item Not Received inquiries with claim_amount, ebay_item_id

### Key Data Concepts

**Order Totals** (immutable vs mutable):
- `original_total` = subtotal + shipping + tax -- frozen at first sync, used as cost basis
- `totals` (JSONB) = current eBay totals -- updated each sync, reflects refunds
- `order_refund` = `original_total - totals.total`

**Inventory States**: `on_hand` -> `to_be_returned` -> `returned` | `parts_repair` | `missing`

**Condition Statuses** (from `conditions.ts`, also loaded dynamically from DB):
good, new, like_new, acceptable, excellent, pressure mark, damaged, wrong_item,
missing_parts, defective, dim power/glitchy, no power, cracked screen, water damage, parts only

**Per-Item Refund Calculation** (three-tier, in `/api/orders/search`):
1. Single-item orders (98.3%) -- exact: full order refund = item refund
2. Multi-item with return/INR records -- exact: matched by `ebay_item_id` + `actual_refund`
3. Multi-item without records -- proportional estimate, flagged for audit (yellow badge)

### Enums
- **UserRole**: ADMIN, RECEIVER, VIEWER
- **TargetStatus**: TARGETED, SNIPE_SCHEDULED, BID_ATTEMPTED, WON, LOST_OUTBID, ENDED_NO_WIN, PURCHASED, CANCELED, EXPIRED
- **TargetType**: AUCTION, BIN, BEST_OFFER
- **ReturnScrapeState**: PENDING, ACTIVE, NEEDS_LOGIN, COMPLETE, FAILED

## Worker / Background Jobs

Run via systemd (`arbdesk-dev-worker`, etc.) using `npm run worker`.

| Job | Schedule | Purpose |
|-----|----------|---------|
| `sync_orders` | Every 30 min | Fetch orders from eBay Trading API (90-day window) |
| `enrich_listing` | On-demand | Fetch GTIN/brand/MPN from Browse API |
| `returns_scrape` | On-demand | Playwright: scrape return status, download label PDF |
| `snipe` | On-demand | Place proxy bid via Offer API (feature-flagged) |
| `reconcile_auction` | On-demand | Check if auction was won |
| `alerts` | Every 60 min | Shipment status monitoring |

**eBay sync guard**: The worker checks `DISABLE_EBAY_SYNC` env var at startup. When `true`, all eBay API jobs (sync, scrape, snipe, reconcile) return immediately without calling eBay. This is set in staging and dev `.env` files to prevent pulling live data into non-production databases. Production does NOT have this var set -- sync runs normally there.

## Authentication

- **NextAuth v4** with JWT strategy + Credentials provider (email/password, bcrypt)
- **RBAC**: `requireRole(["ADMIN"])` helper checks session role
- **Session**: `getServerSession(authOptions)` returns `{user: {id, email, role}}`
- **Custom pages**: `signIn: "/login"` configured in auth options
- **NEXTAUTH_URL**: Must be set in each environment's `.env` to the public URL. Without it, NextAuth defaults to `http://localhost:3000`, causing login/logout to redirect to localhost.
- **Seed user**: `admin@arbdesk.local` / `ChangeMe123!` (via `npx prisma db seed`)

## Environment Variables

### Required
```
DATABASE_URL          # PostgreSQL connection string
REDIS_URL             # Redis connection (dev uses /2, staging /1, prod /0)
NEXTAUTH_SECRET       # 32+ byte hex for JWT signing
NEXTAUTH_URL          # Public app URL (e.g. https://arbdesk.sheltonpropertiesllc.com)
ENCRYPTION_KEY        # 32+ byte hex for AES-256-GCM token encryption
EBAY_CLIENT_ID        # eBay app credentials
EBAY_CLIENT_SECRET
EBAY_REDIRECT_URI     # OAuth callback URL
```

### Optional
```
DISABLE_EBAY_SYNC=true     # Skip eBay API calls (set in staging + dev, NOT production)
FEATURE_OFFER_API=false    # Enable proxy bidding
FEATURE_PLACE_OFFER=false  # Enable Trading PlaceOffer
PLAYWRIGHT_HEADLESS=true   # Browser automation mode
STORAGE_PATH=./storage     # Local file storage path
APP_BASE_URL               # Used by eBay OAuth callback for redirects
```

## Unified Search

Order search (`/orders/search`) and units (`/units`) both use a single search box that handles:
- Typed text: matches order ID, item ID, item title, eBay username, condition, notes
- Tracking numbers: typed partials, full numbers, USPS barcodes (420+ZIP prefix), UPS alphanumeric
- Barcode scanner input: detected via `useBarcodeScanner` hook (rapid keystrokes), routed to search box

Search is powered by `tracking-search.ts` which tries three strategies:
1. Case-insensitive contains match (typed partials, exact numbers)
2. Progressive prefix stripping for USPS barcodes (strips 3-13 chars from front)
3. Digits-only last-12 suffix match (fallback for numeric carrier barcodes)

## Deployment

### Deploy Script (`./deploy.sh`)

**IMPORTANT**: Always run from `/opt/retailarb-dev/` which has the current deploy script.

```bash
./deploy.sh dev          # Pull latest dev code, build, restart
./deploy.sh staging      # Merge dev->staging, copy prod DB to staging+dev, build both
./deploy.sh production   # Backup prod DB, merge staging->main, build, restart
```

### Dev (`./deploy.sh dev`)
1. `git reset --hard origin/arbdesk-dev` (pull latest code)
2. Install deps, generate Prisma client, run migrations, build
3. Restart `arbdesk-dev` + `arbdesk-dev-worker`
4. Database is NOT refreshed -- use `./deploy.sh staging` to reseed from production

### Staging (`./deploy.sh staging`)
1. Push `arbdesk-dev` to GitHub
2. Merge `arbdesk-dev` into `staging` branch, push `staging`
3. `pg_dump` production DB (`arbdesk`) -- read-only, production is never modified
4. Restore dump to staging: stop services, drop/recreate `arbdesk_staging`, restore
5. Restore dump to dev: stop services, drop/recreate `arbdesk_dev`, restore
6. Rebuild dev: install deps, migrate, build, restart dev services
7. Build staging: install deps, migrate, build, restart staging services
8. Both environments now have identical fresh production data

### Production (`./deploy.sh production`)
1. Backup production DB to `/root/backups/arbdesk_pre_deploy_YYYYMMDD_HHMMSS.sql`
2. Push `staging` to GitHub
3. Merge `staging` into `main` (fast-forward), push `main`
4. Install deps, generate Prisma client, run migrations
5. `npm run build` -- compiles TypeScript/React into `.next` production bundle
6. Restart `arbdesk` + `arbdesk-worker`
7. Health check: verify both services are active
8. No data sync is triggered -- worker resumes normal scheduled jobs

### Systemd Services
- **Web**: `arbdesk-dev` / `arbdesk-staging` / `arbdesk`
- **Worker**: `arbdesk-dev-worker` / `arbdesk-staging-worker` / `arbdesk-worker`
- All require `postgresql.service` and `redis-server.service`

### Daily Backups
- Cron at 3 AM: `pg_dump arbdesk > /root/backups/arbdesk_YYYYMMDD.sql`
- 30-day retention (cleanup cron at 4 AM)

### Git Workflow
- Develop on `arbdesk-dev` branch in `/opt/retailarb-dev/`
- Deploy to staging merges `arbdesk-dev -> staging` and seeds both staging+dev DBs from production
- Deploy to production merges `staging -> main` with DB backup first
- Git identity: Mark Shelton / mshelton110580@users.noreply.github.com

## Conventions

- **Path alias**: `@/*` maps to `src/*`
- **Styling**: Tailwind CSS with dark theme (slate/zinc backgrounds)
- **TypeScript**: Strict mode enabled
- **Components**: Mix of server components (data fetching) and client components ("use client" for interactivity)
- **API pattern**: Route handlers export GET/POST/PATCH functions, use `getServerSession` for auth
- **Database**: All IDs are cuid strings, timestamps are `DateTime @default(now())`
- **Decimals**: Financial values use `Decimal @db.Decimal(12, 2)`
- **JSON fields**: `totals`, `status_history`, `lot_manifest`, `raw_json` stored as JSONB
- **Conditions**: Loaded dynamically from DB via `/api/units/conditions`, not hardcoded in UI

## Known Issues / To Do

### Login Error Message
The login form uses `redirect: true` with NextAuth `signIn()`, which means failed login attempts cause a full page redirect instead of showing an inline error message. Fix: change to `redirect: false` and handle the error response client-side.

### Lot Reimport Creates Duplicate Units
**File**: `src/app/api/receiving/import-csv/route.ts` (line 166)

**Issue**: When reimporting scan records for orders already flagged as lots (`is_lot = true`), the duplicate guard is bypassed because `!isAlreadyLot` is false, making `checkedInPreviously` always false for lots. This means every reimport creates additional units on top of existing ones, inflating the scanned count.

**Possible solutions**:
1. Compare scanned count to batch total before creating units
2. Deduplicate by `(tracking_number, scanned_at)` pairs on received_units
3. Add an import batch ID to tag and detect duplicate reimports
