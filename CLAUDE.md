# ArbDesk — eBay Retail Arbitrage Platform

## Quick Reference

- **Stack**: Next.js 14 + TypeScript + Prisma + PostgreSQL 15 + Redis + BullMQ + Anthropic AI (Haiku)
- **Dev**: `/opt/retailarb-dev/` — branch `arbdesk-dev`, port 3002, DB `arbdesk_dev`
- **Staging**: `/opt/retailarb-staging/` — branch `staging`, port 3001, DB `arbdesk_staging`
- **Production**: `/opt/retailarb/` — branch `main`, port 3000, DB `arbdesk`
- **GitHub**: `mshelton110580/retailarb` (PAT auth via git remote)
- **URLs**: `arbdesk.sheltonpropertiesllc.com` (prod), `staging.` (staging), `dev.` (dev) — all via Cloudflare tunnel
- **Git identity**: Mark Shelton / mshelton110580@users.noreply.github.com

## Rules

- **ALL code changes happen on `arbdesk-dev`** in `/opt/retailarb-dev/`
- **NEVER edit production or staging code directly** — changes flow through deploy pipeline
- **NEVER create new git branches** — only `arbdesk-dev`, `staging`, and `main` exist
- `.env` files are gitignored and permanent per-environment — edit directly when needed
- Deploy flow: commit on dev → `./deploy.sh staging` → test → `./deploy.sh production`
- Always run deploy script from `/opt/retailarb-dev/`
- `DISABLE_EBAY_SYNC=true` is set in staging+dev `.env` only — never in production
- `NEXTAUTH_URL` must be set in all `.env` files (without it, redirects go to localhost)
- Conditions are loaded dynamically from DB — never hardcode condition lists in UI
- Images are stored as BYTEA in PostgreSQL (`unit_images.image_data`) — GitHub issue #2 tracks future R2 migration

## Architecture

```
+-------------------------------+     +----------------------+
|  Next.js App (port 300x)      |     |  Worker (ts-node)    |
|  — App Router pages           |     |  — sync_orders (30m) |
|  — API routes (/api/*)        |---->|  — enrich_listing    |
|  — Server components          |redis|  — returns_scrape    |
+---------+---------------------+     |  — snipe             |
          |                           |  — reconcile_auction  |
          | prisma                    |  — alerts (60m)      |
+---------v---------------------+     +----------+-----------+
|  PostgreSQL 15                |                |
|  (arbdesk / arbdesk_dev / etc)|     +----------v-----------+
+-------------------------------+     |  eBay APIs           |
                                      |  — Trading (orders)  |
                                      |  — Browse (enrich)   |
                                      |  — Post-Order (ret)  |
                                      |  — Offer (bids)      |
                                      +----------------------+
                                      |  Anthropic AI        |
                                      |  — claude-haiku-4-5  |
                                      |  — Product parsing   |
                                      |  — Lot detection     |
                                      +----------------------+
```

## Application Pages

### Dashboard (`/`)
Static landing page with feature overview cards and quick navigation.

### Login (`/login`)
NextAuth credentials login (email/password). Uses `redirect: false` for inline error display.

### Orders (`/orders`)
Browse orders with date range filter and check-in status filter (All/Checked In/Not Checked In). Shows items with proportional cost allocation, shipment status badges, and refund indicators.

### Order Detail (`/orders/[orderId]`)
Comprehensive view with sections:
- **Order details** — status, dates, original vs current total, refund detection
- **Items** — per-item cost breakdown with proportional shipping/tax
- **Tracking & shipments** — status badges, check-in state, lot indicators, scan progress
- **Received units** — condition badges, notes, photo thumbnails
- **Returns** — state badges (green=closed, yellow=requested, red=active), refund amounts, return tracking with ship/delivery dates
- **INR cases** — status, claim amounts, escalation indicators
- **Quick links** — eBay deep links, file return/INR per item

### Order Search (`/orders/search`)
Advanced search (~1,576 lines). Key features:
- **Unified search** — order ID, item ID, title, tracking numbers, eBay username
- **Barcode scanner** — hardware scanner detection via `useBarcodeScanner` hook
- **Filters** — account, date range, order status, ship status, check-in
- **15 columns** — all sortable, resizable, show/hide customizable
- **Per-item refund badges** — Full (red), Partial (amber), Audit (yellow), None
- **Return/INR badges** — with escalation indicators and hover tooltips
- **Virtual scrolling** — handles 1000+ rows efficiently
- **Group by** — orders or items display mode

### Inventory Dashboard (`/inventory`)
Order status dashboard with drilldown filtering. Categories:
- **Delivery status** — Total, Cancelled & Refunded, Delivered, In Transit, Awaiting Shipment
- **Warehouse status** — Checked In, Not Checked In
- **Action items** — Delivered Not Checked In, Never Shipped, Overdue, Needs Return, Contact Seller, Missing Units, Check Quantity (Lots)
- **Completed** — Reviewed Lots
- **eBay cases** — Returns, INR Cases
- **Return tracking** — 6 pipeline stages from Filed to Refunded

Clicking a card shows matching shipments with full order/unit details and scan progress.

### On-Hand Inventory (`/on-hand`)
Per-product inventory grouped by product. Shows unit counts and refund-adjusted values by state (on_hand, to_be_returned, parts_repair, returned, missing). Expandable rows with per-unit cost, condition, notes, and order links. Refund allocation uses `original_total` as frozen cost basis with three-tier calculation.

### Receiving (`/receiving`)
Warehouse barcode scanning workflow:
- **Scan input** — barcode scanner or manual tracking entry with condition dropdown
- **Single unit scans** — immediate check-in with optional image upload for non-good conditions
- **Shared tracking (pool)** — progress tracking for multiple shipments in one box
- **Lot confirmation modal** — multi-step flow:
  1. **Breakdown** — AI-detected product split, editable quantities
  2. **Confirm** — expected vs received counts, confidence levels, manual product selection if needed
  3. **Conditions** — per-unit condition assignment
- **Multi-qty orders** — orders with qty > 1 get combined modal (e.g., 2× "LOT OF 6" = 12 units shown as Lot A/Lot B)
- **Scan list** — chronological log grouped by tracking, with per-unit edit/delete actions

### Receiving Import (`/receiving/import`)
CSV bulk import with flexible column mapping (aliases for header names). Parses conditions (splits "good no cover" → condition + notes). Validates duplicates and tracking format.

### Units (`/units`)
Search, filter, and bulk-edit received units:
- **Filters** — product, condition, inventory state, date range, text search
- **Inline editing** — condition (dropdown), state (toggle), notes (text), product (search/create)
- **Bulk actions** — select multiple, bulk update condition/state, bulk delete
- **Column customization** — resize, show/hide, widths persisted to localStorage
- **Virtual scrolling** for large datasets

### Returns (`/returns`)
Return case management with tabs: All, Open, Closed (Full/Partial/No Refund), Escalated. Per-return: state badges, reason, refund amounts, return tracking with dates, eBay links.

### INR Cases (`/inr`)
Item Not Received case tracking with tabs: All, Open, Open (not escalated), Closed (Full/Partial/No Refund), Late. Shows claim amounts, delivery status, escalation indicators.

### Targets (`/targets`)
Auction snipe target management. Create targets by item ID with type (AUCTION/BIN/BEST_OFFER), max bid, and timing. Lists all targets with status, enriched listing info, and eBay links.

### eBay Accounts (`/ebay-accounts`)
OAuth connection management. Connect new accounts (18 scopes), view token status (valid/expired), re-authenticate, disconnect. Tokens encrypted with AES-256-GCM.

### Inbound (`/inbound`)
Placeholder for non-eBay inbound package tracking. Not yet implemented.

### Settings (`/settings`)
Feature flags: `FEATURE_OFFER_API`, `FEATURE_PLACE_OFFER`, `PLAYWRIGHT_HEADLESS`. Encryption key status display.

### Admin: Users (`/admin/users`)
ADMIN only. Create, edit role, delete users. Three roles: ADMIN, RECEIVER, VIEWER.

### Admin: Products (`/admin/products`)
ADMIN only. Product database management:
- **Duplicate detection** — groups by normalized name
- **Merge** — reassign units from source to target product, create alias mapping
- **Delete** — only if no units assigned
- **Merge history** — previous alias mappings

### Admin: Conditions (`/admin/conditions`)
ADMIN only. View/manage condition values. Built-in conditions (good, new_sealed, like_new, etc.) cannot be deleted. Custom conditions deletable if unused.

### Dev Tools (`/dev`)
Hidden ADMIN-only page. File inspection, clear/reimport returns/INR, clear received units, eBay export backfill.

## API Endpoints

### Orders
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders/search` | GET | Advanced search with filtering, sorting, pagination, per-item refund calc |
| `/api/orders/sync` | POST | Sync orders from eBay Trading API (90-day window) |
| `/api/orders/import-ebay-export` | POST | Backfill original_total from eBay CSV export |
| `/api/orders/inspect-ebay-export` | POST | Preview CSV structure before import |

### Receiving
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/receiving/scan` | POST | Primary barcode scan — AI lot detection, shared tracking, pool progress |
| `/api/receiving/scan/[id]` | DELETE | Undo scan + delete associated units |
| `/api/receiving/confirm-lot` | POST | Batch confirm lot units with products/conditions |
| `/api/receiving/import-csv` | POST | Bulk CSV import of received units |
| `/api/receiving/fetch-sheet` | POST | Fetch CSV from public Google Sheets URL |
| `/api/receiving/order/[orderId]` | DELETE | Delete all units for an order, reset shipment |
| `/api/receiving/unit/[unitId]` | DELETE | Delete single unit, recalculate shipment |
| `/api/receiving/unit/[unitId]/product` | PATCH | Update unit product assignment |

### Units
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/units` | GET | List/search units with filtering and pagination |
| `/api/units/[unitId]` | PATCH | Update unit condition/notes/product |
| `/api/units/bulk` | PATCH | Bulk update product/condition on multiple units |
| `/api/units/conditions` | GET/DELETE | List all conditions / delete custom condition |

### Returns & INR
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/returns` | POST | Create return record manually |
| `/api/returns/filed` | POST | Mark return as filed, queue scrape |
| `/api/returns/refresh` | POST | Refresh return scrape (5-min rate limit) |
| `/api/inr` | POST | File INR case manually |

### Sync
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/all` | POST | Run orders sync then returns/INR sync |
| `/api/sync/returns` | POST | Sync returns, inquiries, cases from Post-Order API (90-day window) |

### Products
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/products` | GET/POST/DELETE | List/create/delete products |
| `/api/products/create` | POST | Create product with optional GTIN |
| `/api/products/merge` | POST | Create product alias mapping |
| `/api/products/merge/[id]` | DELETE | Delete alias mapping |
| `/api/products/units` | GET | Get all units for a product |

### Reconciliation
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/reconciliation/[shipmentId]` | GET/PATCH | Get lot details / mark reviewed/overridden |
| `/api/reconciliation/[shipmentId]/add-unit` | POST | Add missing units to lot |

### Other
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/targets` | GET/POST | List/create snipe targets |
| `/api/ebay-accounts` | GET/POST/DELETE/PATCH | Manage eBay OAuth accounts |
| `/api/auth/ebay/callback` | GET | eBay OAuth redirect handler |
| `/api/images/[id]` | GET | Serve image from PostgreSQL (1-year cache) |
| `/api/uploads/session` | POST | Create upload session for QR code photo upload |
| `/api/uploads/session/[id]` | GET | Get session status + images |
| `/api/uploads/session/[id]/photos` | POST | Upload photos (sharp compression, EXIF rotation) |
| `/api/admin/users` | GET/POST | List/create users |
| `/api/admin/users/[id]` | PATCH/DELETE | Update/delete user |
| `/api/admin/products/merge` | POST | Full product merge (reassign units + delete source) |
| `/api/admin/clear-scan-data` | POST | Delete all receiving/scan data |
| `/api/admin/recompute-states` | POST | Recompute all inventory states |
| `/api/dev/*` | Various | Dev tools (clear data, upload, save eBay session) |

## Database Models

### Core Business Flow
1. **ebay_accounts** — OAuth-connected eBay accounts (tokens encrypted AES-256-GCM)
2. **targets** — Items to monitor/snipe (AUCTION, BIN, BEST_OFFER) with status history
3. **listings** — eBay item metadata (title, GTIN, brand, MPN, raw_json from Browse API)
4. **orders** — eBay orders with immutable `original_total` (cost basis) and mutable `totals` (current)
5. **order_items** — Line items (qty, transaction_price, shipping_cost, final_price)
6. **shipments** — Delivery tracking with derived_status, check-in state, lot metadata, reconciliation_status
7. **tracking_numbers** — Carrier + tracking number + status text per shipment
8. **receiving_scans** — Barcode scanner log (tracking, resolution state, scanner user)
9. **received_units** — Physical inventory (condition, inventory_state, product, order link, images)
10. **unit_images** — Photos stored as BYTEA with content_type
11. **upload_sessions** — Temporary QR code upload tokens (24h expiry)
12. **lots** + **lot_units** — Lot groupings with unit index tracking
13. **returns** — eBay return requests (state, refund amounts, return tracking, label PDFs, scrape state)
14. **inr_cases** — Item Not Received (inquiry ID, claim amount, escalation to case)
15. **products** — Product catalog (name, GTIN, keywords)
16. **product_aliases** — Name → product ID mappings for auto-matching
17. **condition_templates** — Return message templates by condition
18. **audit_log** — Action trail (actor, action, entity, payload)
19. **users** — Auth accounts (email, password hash, role)

### Key Data Concepts

**Order totals** (immutable vs mutable):
- `original_total` = subtotal + shipping + tax — frozen at first sync, used as cost basis
- `totals` (JSONB) = current eBay totals — updated each sync, reflects refunds
- `order_refund` = `original_total - totals.total`

**Inventory states**: `on_hand` → `to_be_returned` → `returned` | `parts_repair` | `missing`

**Inventory state logic** (in `inventory-transitions.ts`):
- Return shipped/delivered + bad condition → `returned`
- Return shipped/delivered + good condition → `on_hand`
- Return closed with refund + bad condition → `parts_repair`
- Return open/pending → `to_be_returned`
- No return + bad condition → `to_be_returned`

**Per-item refund calculation** (three-tier, in `/api/orders/search`):
1. Single-item orders (98.3%) — exact: full order refund = item refund
2. Multi-item with return/INR records — exact: matched by `ebay_item_id` + `actual_refund`
3. Multi-item without records — proportional estimate, flagged for audit (yellow badge)

**Shipping status derivation** (in `shipping.ts`):
- delivered, canceled, shipped, late, not_delivered, not_received, pre_shipment, pending
- Thresholds: 7 days expected transit, 3 days tracked overdue, 14 days untracked overdue

### Enums
- **UserRole**: ADMIN, RECEIVER, VIEWER
- **TargetStatus**: TARGETED, SNIPE_SCHEDULED, BID_ATTEMPTED, WON, LOST_OUTBID, ENDED_NO_WIN, PURCHASED, CANCELED, EXPIRED
- **TargetType**: AUCTION, BIN, BEST_OFFER
- **ReturnScrapeState**: PENDING, ACTIVE, NEEDS_LOGIN, COMPLETE, FAILED
- **ResolutionState**: UNRESOLVED, MATCHED, DISMISSED

## AI Integration

**Model**: `claude-haiku-4-5-20251001` via Anthropic SDK (`ANTHROPIC_API_KEY`)

**Product parsing** (`src/lib/ai/product-parser.ts`):
- Extracts: brand, productLine, model, variant, color, productType, canonicalName
- In-memory cache (500 items, LRU eviction by normalized title)
- Regex fallback if API fails (50+ known brands, 30+ colors, 40+ product types)

**Lot detection** (`src/lib/ai/prompts/product-parsing.ts`):
- Detects lot count from title patterns ("Lot of X", number prefixes, multiple models)
- Mixed lot support: "&" between models = distinct products, unknown splits get qty 0
- eBay listing description used as evidence (more accurate than title for misleading listings)
- GTIN/MPN/Color from eBay item specifics enhance detection
- Tracked product names injected to ensure exact matches

**Product matching** (`src/lib/product-matching.ts`):
- Flow: GTIN exact match → product alias lookup → AI field similarity scoring
- Similarity scoring (max 100): color 30pts + model 35pts + brand 20pts + type 15pts
- Confidence: high (90%+) auto-assign, medium (70-89%) confirm, low (<70%) manual

**Product cache** (`src/lib/ai/product-cache.ts`):
- In-memory Map of all products' parsed ProductInfo
- Lazy-initialized on first call, updated on create/delete

## Unified Search

Order search (`/orders/search`) and units (`/units`) both use a single search box:
- Typed text: matches order ID, item ID, item title, eBay username, condition, notes
- Tracking numbers: typed partials, full numbers, USPS barcodes (420+ZIP prefix), UPS
- Barcode scanner: detected via `useBarcodeScanner` hook (8+ chars in 150ms)

Search powered by `tracking-search.ts` with three strategies:
1. Case-insensitive contains match
2. Progressive prefix stripping for USPS barcodes (strips 3-13 chars)
3. Digits-only last-12 suffix match (fallback for numeric carrier barcodes)

## Key Libraries

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | NextAuth JWT config + credentials provider |
| `src/lib/db.ts` | Prisma singleton (global cache in dev) |
| `src/lib/rbac.ts` | `requireRole(roles)` helper for API auth |
| `src/lib/queue.ts` | BullMQ queue factory (IORedis from REDIS_URL) |
| `src/lib/crypto.ts` | AES-256-GCM encrypt/decrypt for eBay tokens |
| `src/lib/shipping.ts` | `deriveShippingStatus()` — delivery state machine |
| `src/lib/storage.ts` | File system abstraction (STORAGE_PATH) |
| `src/lib/date-range.ts` | Date range parsing (30/60/90 days, custom) |
| `src/lib/inventory-transitions.ts` | Inventory state recomputation from returns/conditions |
| `src/lib/product-matching.ts` | AI product matching + similarity scoring |
| `src/lib/tracking-search.ts` | Unified tracking number search |
| `src/lib/use-barcode-scanner.ts` | React hook for hardware barcode scanner detection |
| `src/lib/ebay/trading.ts` | GetOrders XML-RPC (100/page, pagination) |
| `src/lib/ebay/post-order.ts` | Returns/INR/Cases REST API (search + detail) |
| `src/lib/ebay/browse.ts` | Item enrichment via Browse API (GTIN, brand, MPN) |
| `src/lib/ebay/offer.ts` | Proxy bidding via Offer API |
| `src/lib/ebay/oauth.ts` | OAuth code exchange + token refresh |
| `src/lib/ebay/token.ts` | `getValidAccessToken()` — auto-refresh expired tokens |
| `src/lib/ai/client.ts` | Anthropic SDK singleton |
| `src/lib/ai/product-parser.ts` | AI product/lot extraction with caching |
| `src/lib/ai/product-cache.ts` | In-memory product info cache |
| `src/lib/ai/prompts/product-parsing.ts` | System prompts + tool definitions for AI |

## Reusable Components

| Component | Purpose |
|-----------|---------|
| `image-upload-panel.tsx` | QR code photo upload with real-time polling (2.5s) |
| `check-in-modal.tsx` | Full receiving workflow: condition → scanning → product → photos |
| `check-quantity-panel.tsx` | Lot quantity reconciliation view |
| `lot-reconciliation.tsx` | Lot detail editor: per-unit condition/state/photos, add missing units |
| `date-range-filter.tsx` | Date range picker with presets (30d/60d/90d/All) |
| `page-header.tsx` | Page title layout with optional action buttons |
| `sync-all-button.tsx` | Trigger full sync (orders + returns/INR) |
| `sync-returns-button.tsx` | Manual return sync with result display |
| `sign-out-button.tsx` | NextAuth sign-out |
| `filter-link.tsx` | Dynamic filter toggle button |

## Worker / Background Jobs

Run via systemd using `npm run worker`. All jobs guarded by `DISABLE_EBAY_SYNC`.

| Job | Schedule | Purpose |
|-----|----------|---------|
| `sync_orders` | Every 30 min | Fetch orders from eBay Trading API (90-day window) |
| `enrich_listing` | On-demand | Fetch GTIN/brand/MPN from Browse API, store raw_json |
| `returns_scrape` | On-demand | Playwright: scrape return status, download label PDF |
| `snipe` | On-demand | Place proxy bid via Offer API (feature-flagged) |
| `reconcile_auction` | On-demand | Check if auction was won |
| `alerts` | Every 60 min | Log undelivered shipments to audit_log |

## Authentication

- **NextAuth v4** with JWT strategy + Credentials provider (email/password, bcrypt)
- **RBAC**: `requireRole(["ADMIN"])` helper checks session role
- **Session**: `getServerSession(authOptions)` → `{user: {id, email, role}}`
- **JWT callbacks**: on sign-in adds role; on refresh re-validates user exists + syncs role from DB
- **Seed user**: `admin@arbdesk.local` / `ChangeMe123!` (via `npx prisma db seed`)

## Environment Variables

### Required
```
DATABASE_URL          # PostgreSQL connection string
REDIS_URL             # Redis connection (dev /2, staging /1, prod /0)
NEXTAUTH_SECRET       # 32+ byte hex for JWT signing
NEXTAUTH_URL          # Public app URL (e.g. https://arbdesk.sheltonpropertiesllc.com)
ENCRYPTION_KEY        # 32+ byte hex for AES-256-GCM token encryption
EBAY_CLIENT_ID        # eBay app credentials
EBAY_CLIENT_SECRET
EBAY_REDIRECT_URI     # OAuth callback URL
ANTHROPIC_API_KEY     # For AI product parsing/lot detection
```

### Optional
```
DISABLE_EBAY_SYNC=true     # Skip eBay API calls (staging + dev only)
FEATURE_OFFER_API=false    # Enable proxy bidding
FEATURE_PLACE_OFFER=false  # Enable Trading PlaceOffer
PLAYWRIGHT_HEADLESS=true   # Browser automation mode
STORAGE_PATH=./storage     # Local file storage path
APP_BASE_URL               # Used by eBay OAuth callback for redirects
```

## Deployment

### Deploy Script (`./deploy.sh`)

**IMPORTANT**: Always run from `/opt/retailarb-dev/`.

```bash
./deploy.sh dev          # Pull latest dev code, build, restart
./deploy.sh staging      # Merge dev→staging, copy prod DB to staging+dev, build both
./deploy.sh production   # Backup prod DB, merge staging→main, build, restart
```

**Dev**: `git reset --hard origin/arbdesk-dev` → install → migrate → build → restart services. DB not refreshed.

**Staging**: Push dev → merge into staging → `pg_dump` production → restore to staging+dev DBs → rebuild both. Both environments get fresh production data.

**Production**: Backup DB to `/root/backups/` → push staging → merge into main → install → migrate → build → restart. Worker resumes scheduled jobs.

### Systemd Services
- **Web**: `arbdesk-dev` / `arbdesk-staging` / `arbdesk`
- **Worker**: `arbdesk-dev-worker` / `arbdesk-staging-worker` / `arbdesk-worker`
- All require `postgresql.service` and `redis-server.service`

### Daily Backups
- Cron at 3 AM: `pg_dump arbdesk > /root/backups/arbdesk_YYYYMMDD.sql`
- 30-day retention (cleanup cron at 4 AM)

## Conventions

- **Path alias**: `@/*` maps to `src/*`
- **Styling**: Tailwind CSS with dark theme (slate/zinc backgrounds)
- **TypeScript**: Strict mode
- **Components**: Server components for data fetching, client components ("use client") for interactivity
- **API pattern**: Route handlers export GET/POST/PATCH/DELETE, use `getServerSession` for auth
- **Database**: All IDs are cuid strings, timestamps `DateTime @default(now())`
- **Decimals**: Financial values use `Decimal @db.Decimal(12, 2)`
- **JSON fields**: `totals`, `status_history`, `lot_manifest`, `raw_json` stored as JSONB
- **Color scheme**: green=success/good, blue=info/new, yellow=warning/audit, red=error/damaged, amber=partial, rose=defective, slate=neutral/closed

## Known Issues

### Lot Reimport Creates Duplicate Units
**File**: `src/app/api/receiving/import-csv/route.ts`
When reimporting scan records for orders already flagged as lots (`is_lot = true`), the duplicate guard is bypassed. Every reimport creates additional units on top of existing ones.

### Re-scan Guard Missing
No guard against re-scanning already-complete shipments. Scanning a completed shipment again could create duplicate units.
