# ArbDesk - eBay Retail Arbitrage Workspace

## Quick Reference

- **Stack**: Next.js 14 + TypeScript + Prisma + PostgreSQL 15 + Redis + BullMQ
- **Dev**: `/opt/retailarb-dev/` — branch `arbdesk-dev`, port 3002, DB `arbdesk_dev`
- **Staging**: `/opt/retailarb-staging/` — branch `staging`, port 3001, DB `arbdesk_staging`
- **Production**: `/opt/retailarb/` — branch `main`, port 3000, DB `arbdesk`
- **GitHub**: `mshelton110580/retailarb` (PAT auth via git remote)
- **URLs**: `arbdesk.sheltonpropertiesllc.com` (prod), `staging.` (staging), `dev.` (dev) — all via Cloudflare tunnel
- **Deploy**: `./deploy.sh dev|staging|production` — merges branches, installs, migrates, builds, restarts systemd services

## Architecture Overview

```
┌─────────────────────────────────┐     ┌──────────────────────┐
│  Next.js App (port 300x)       │     │  Worker (ts-node)    │
│  ├─ App Router pages           │     │  ├─ sync_orders (30m)│
│  ├─ API routes (/api/*)        │────▶│  ├─ enrich_listing   │
│  └─ Server components          │redis│  ├─ returns_scrape   │
└─────────┬───────────────────────┘     │  ├─ snipe            │
          │                             │  ├─ reconcile_auction│
          │ prisma                      │  └─ alerts (60m)     │
┌─────────▼───────────────────────┐     └──────────┬───────────┘
│  PostgreSQL 15                  │                │
│  (arbdesk / arbdesk_dev / etc.) │     ┌──────────▼───────────┐
└─────────────────────────────────┘     │  eBay APIs           │
                                        │  ├─ Trading (orders) │
                                        │  ├─ Browse (enrich)  │
                                        │  ├─ Post-Order (ret) │
                                        │  └─ Offer (bids)     │
                                        └──────────────────────┘
```

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout with nav bar
│   ├── page.tsx                  # Dashboard
│   ├── login/                    # Auth login page
│   ├── orders/                   # Order list, search, detail
│   │   ├── page.tsx              # Simple order list with date filters
│   │   ├── search/               # Advanced search with grid
│   │   │   ├── page.tsx          # Server component wrapper
│   │   │   └── order-search.tsx  # Client component (virtualized table, ~1200 lines)
│   │   └── [orderId]/            # Order detail view
│   ├── inventory/                # Dashboard with delivery/return status buckets
│   ├── on-hand/                  # Per-product inventory with refund allocation
│   ├── receiving/                # Warehouse scan workflows + CSV import
│   ├── units/                    # Unit search/filter/bulk-edit table
│   ├── returns/                  # Return request management
│   ├── inr/                      # Item Not Received cases
│   ├── targets/                  # Auction sniping targets
│   ├── ebay-accounts/            # OAuth connection management
│   ├── admin/                    # Users, categories, conditions
│   ├── settings/                 # Feature flags
│   └── api/                      # 44 API endpoints (see below)
├── components/                   # 11 reusable components
├── lib/                          # Utilities and integrations
│   ├── auth.ts                   # NextAuth config (JWT + credentials)
│   ├── db.ts                     # Prisma singleton
│   ├── rbac.ts                   # Role-based access control
│   ├── queue.ts                  # BullMQ queue definitions
│   ├── crypto.ts                 # AES-256-GCM for eBay tokens
│   ├── conditions.ts             # Condition enum constants
│   ├── shipping.ts               # Shipping status state machine
│   ├── storage.ts                # File storage (local, S3-ready)
│   ├── date-range.ts             # Server-side date filtering
│   ├── inventory-transitions.ts  # Inventory state machine
│   ├── item-categorization.ts    # Smart product categorization
│   └── ebay/                     # eBay API wrappers
│       ├── trading.ts            # GetOrders (XML-RPC)
│       ├── post-order.ts         # Returns/INR/Cases (REST)
│       ├── browse.ts             # Item enrichment (REST)
│       ├── offer.ts              # Proxy bidding (REST)
│       ├── oauth.ts              # OAuth code exchange
│       └── token.ts              # Token refresh
├── types/
│   └── next-auth.d.ts            # Session type augmentation
└── worker/
    └── index.ts                  # BullMQ job processors
```

## Key API Endpoints

| Area | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| Orders | `/api/orders/search` | GET | Advanced search with filtering, sorting, pagination |
| Orders | `/api/orders/sync` | POST | Sync orders from eBay Trading API |
| Receiving | `/api/receiving/scan` | POST | Process warehouse barcode scan |
| Units | `/api/units` | GET | List/search units with virtual scrolling |
| Units | `/api/units/bulk` | PATCH | Bulk update units (state, category, condition) |
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
1. **ebay_accounts** — OAuth-connected eBay accounts (tokens encrypted with AES-256-GCM)
2. **targets** — Items to monitor/snipe (AUCTION, BIN, BEST_OFFER)
3. **listings** — eBay product metadata (title, GTIN, brand, MPN from Browse API)
4. **orders** — Purchased eBay orders with immutable cost basis (`original_total`)
5. **order_items** — Line items (qty, transaction_price, shipping_cost per item)
6. **shipments** + **tracking_numbers** — Inbound delivery tracking
7. **received_units** — Physical inventory (condition, inventory_state, category)
8. **returns** — Return requests with actual_refund, tracking, label PDFs
9. **inr_cases** — Item Not Received inquiries with claim_amount

### Key Data Concepts

**Order Totals** (immutable vs mutable):
- `original_total` = subtotal + shipping + tax — frozen at first sync, used as cost basis
- `totals` (JSONB) = current eBay totals — updated each sync, reflects refunds
- `order_refund` = `original_total - totals.total`

**Inventory States**: `on_hand` → `to_be_returned` → `returned` | `parts_repair` | `missing`

**Condition Statuses**: good, missing_parts, pressure mark, dim power/glitchy, no power

**Per-Item Refund Calculation** (three-tier):
1. Single-item orders (98.3%) — exact: full order refund = item refund
2. Multi-item with return/INR records — exact: matched by `ebay_item_id` + `actual_refund`
3. Multi-item without records — proportional estimate, flagged for audit

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

**Dev guard**: `DISABLE_EBAY_SYNC=true` in dev .env skips all eBay API calls.

## Authentication

- **NextAuth v4** with JWT strategy + Credentials provider (email/password, bcrypt)
- **RBAC**: `requireRole(["ADMIN"])` helper checks session role
- **Session**: `getServerSession(authOptions)` returns `{user: {id, email, role}}`
- **Seed user**: `admin@arbdesk.local` / `ChangeMe123!` (via `npx prisma db seed`)

## Environment Variables

### Required
```
DATABASE_URL          # PostgreSQL connection string
REDIS_URL             # Redis connection (dev uses /2)
NEXTAUTH_SECRET       # 32+ byte hex for JWT signing
NEXTAUTH_URL          # Public app URL
ENCRYPTION_KEY        # 32+ byte hex for AES-256-GCM token encryption
EBAY_CLIENT_ID        # eBay app credentials
EBAY_CLIENT_SECRET
EBAY_DEV_ID
EBAY_REDIRECT_URI     # OAuth callback URL
```

### Optional
```
DISABLE_EBAY_SYNC=true     # Skip eBay API calls (dev only)
FEATURE_OFFER_API=false    # Enable proxy bidding
FEATURE_PLACE_OFFER=false  # Enable Trading PlaceOffer
PLAYWRIGHT_HEADLESS=true   # Browser automation mode
STORAGE_PATH=./storage     # Local file storage path
```

## Development Workflow

### Commands
```bash
npm run dev              # Dev server (port from .env)
npm run build            # Production build
npm run worker           # Start background worker
npx prisma migrate dev   # Create/apply migration
npx prisma generate      # Regenerate Prisma client
npx prisma db seed       # Seed admin user
```

### Deployment (`deploy.sh`)

```bash
./deploy.sh dev          # Pull latest dev code, install, migrate, build, restart
./deploy.sh staging      # Merge dev→staging, seed both staging+dev DBs from prod, build both
./deploy.sh production   # Backup prod DB, merge staging→main, build
```

**Dev** (`./deploy.sh dev`):
1. `git reset --hard origin/arbdesk-dev` (pull latest code)
2. Install deps, generate Prisma client, run migrations, build
3. Restart `arbdesk-dev` + `arbdesk-dev-worker`
4. Database is NOT refreshed — use `./deploy.sh staging` to reseed from production

**Staging** (`./deploy.sh staging`):
1. Push `arbdesk-dev` to GitHub
2. Merge `arbdesk-dev` into `staging` branch, push `staging`
3. `pg_dump` production DB (`arbdesk`) — read-only, production is never modified
4. **Restore to staging**: stop staging services, drop/recreate `arbdesk_staging`, restore dump
5. **Restore to dev**: stop dev services, drop/recreate `arbdesk_dev`, restore same dump
6. **Rebuild dev**: install deps, migrate, build, restart `arbdesk-dev` + `arbdesk-dev-worker`
7. **Build staging**: install deps, migrate, build, restart `arbdesk-staging` + `arbdesk-staging-worker`
8. Both environments now have identical production data with any new migrations applied
9. Dev test data is wiped — this is intentional since dev changes have been promoted

**Production** (`./deploy.sh production`):
1. Backup production DB to `/root/backups/arbdesk_pre_deploy_YYYYMMDD_HHMMSS.sql`
2. Push `staging` to GitHub
3. Merge `staging` into `main` branch, push `main`
4. Install deps, generate Prisma client, run migrations, build
5. Restart `arbdesk` + `arbdesk-worker`

### Systemd Services
- **Web**: `arbdesk-dev` / `arbdesk-staging` / `arbdesk`
- **Worker**: `arbdesk-dev-worker` / `arbdesk-staging-worker` / `arbdesk-worker`
- All require `postgresql.service` and `redis-server.service`

### Git Workflow
- Develop on `arbdesk-dev` branch in `/opt/retailarb-dev/`
- Deploy to staging merges `arbdesk-dev → staging` and seeds both staging+dev DBs from production
- Deploy to production merges `staging → main` with DB backup first
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

## To Do

### Lot Reimport Creates Duplicate Units
**File**: `src/app/api/receiving/import-csv/route.ts` (line 166)

**Issue**: When reimporting scan records for orders already flagged as lots (`is_lot = true`), the duplicate guard is bypassed because `!isAlreadyLot` is false, making `checkedInPreviously` always false for lots. This means every reimport creates additional units on top of existing ones, inflating the scanned count.

The lot exception exists so that *within a single import batch*, repeated tracking numbers correctly create additional lot units. But it also prevents the skip logic from working on *subsequent* reimports of identical data.

**Possible solutions**:
1. **Compare scanned count to batch total**: Before creating units, count how many rows in the current batch share this tracking number. If `existingCount` already equals `expected_units * lot_size` (or the batch's total qty for this tracking), skip instead of creating more.
2. **Deduplicate by timestamp + tracking**: Track `(tracking_number, scanned_at)` pairs on received_units. If an identical pair already exists, skip the row as a duplicate reimport.
3. **Add an import batch ID**: Tag each received_unit with an import batch identifier. On reimport, detect that all rows in the batch already have units with the same batch signature and skip.

