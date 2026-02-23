# REHYDRATE — Arbdesk (retailarb)

Read this file at the start of every session before touching any code.

---

## Project Summary

**Arbdesk** is a Next.js 14 (App Router) internal tool for managing eBay reseller arbitrage operations.
It tracks purchased orders, inbound shipments, receiving/check-in, inventory states, returns, INR cases, and targets.

- **Stack**: Next.js 14, TypeScript, Prisma 5 + PostgreSQL, Tailwind CSS, BullMQ + Redis, NextAuth
- **App**: `src/app/` — App Router pages + API routes
- **Worker**: `src/worker/index.ts` — BullMQ background jobs (sync, enrichment, snipe, etc.)
- **Deploy target**: DigitalOcean VPS at `/opt/retailarb` — systemd services `arbdesk` + `arbdesk-worker`
- **Public URL**: `https://arbdesk.sheltonpropertiesllc.com` via Cloudflare Tunnel (systemd: `cloudflared.service`)
- **Tunnel routes**: `arbdesk.sheltonpropertiesllc.com` → `http://localhost:3000`
- **Source of truth**: GitHub `origin/arbdesk-dev`

---

## ABSOLUTE RULES — READ EVERY SESSION

1. **Always on branch `arbdesk-dev`**. Never create other branches. Never create `arbdesk-sync`.
2. Run `.ai/verify-branch.sh` before every commit or deploy step.
3. All commits go to `origin/arbdesk-dev`. Never deploy from a local-only state.
4. Never print or log secrets, tokens, or `.env` contents.
5. VPS deploy via `systemctl restart arbdesk arbdesk-worker` (see DEPLOY_DO_VPS.md).

---

## Current Objective

<!-- Update this each session -->
**Objective**: No active objective. All known issues resolved.

---

## Current State Summary (as of 2026-02-22)

- Branch `arbdesk-dev` is the working branch; `main` is the stable production baseline.
- All three systemd services are **active**: `arbdesk`, `arbdesk-worker`, `cloudflared`.
- INR delivery fix shipped at commit `afba73e` — order `02-14043-95213` shows `derived_status=delivered`.
- Multi-qty lot detection is fixed (scan + import-csv routes).
- Receiving log shows correct "2 lots × 6 units" display.
- Delete button exists for both scanned and imported receiving entries.

---

## Key Decisions / Constraints

| Decision | Detail |
|---|---|
| Branch | `arbdesk-dev` only — never create other branches |
| Deploy | DigitalOcean VPS via systemd, not Docker Compose or pm2 |
| Public access | `https://arbdesk.sheltonpropertiesllc.com` → Cloudflare Tunnel → `localhost:3000` |
| Cloudflare tunnel | systemd `cloudflared.service` — `After=arbdesk.service`. Must keep `arbdesk` running or tunnel gets 502. |
| DB migrations | `npx prisma migrate dev` (dev) / `npx prisma migrate deploy` (prod) |
| Inventory states | `on_hand`, `to_be_returned`, `parts_repair`, `returned`, `missing` — see `src/lib/inventory-transitions.ts` |
| Shipment status | Derived by `deriveShippingStatus()` in `src/lib/shipping.ts` — only uses eBay order API `actualDelivery` field |
| INR delivery gap | eBay order API does NOT update `actualDelivery` when tracking is added via INR response; must pull from Post-Order inquiry API |
| No arbdesk-sync | This branch was accidentally created and deleted. Never recreate it. |

---

## Commands (verified in repo)

```bash
# Install
npm ci --legacy-peer-deps

# Generate Prisma client
npx prisma generate

# Build
npm run build

# Start (production — use systemd on VPS, not this directly)
npm run start           # next start -p 3000

# Dev server (local only)
npm run dev

# Lint
npm run lint

# Worker (background jobs)
npm run worker          # ts-node src/worker/index.ts

# DB migrate (dev)
npx prisma migrate dev

# DB migrate (prod)
npx prisma migrate deploy
```

---

## Critical Paths

| Path | Purpose |
|---|---|
| `src/app/api/sync/returns/route.ts` | Syncs returns, INR inquiries, escalated cases from eBay Post-Order API |
| `src/app/api/orders/sync/route.ts` | Syncs orders from eBay Orders API; writes `delivered_at` from `actualDelivery` |
| `src/lib/shipping.ts` | `deriveShippingStatus()` — computes shipment status from delivery/tracking fields |
| `src/lib/inventory-transitions.ts` | `updateInventoryStatesFromReturns()` — state machine for received_units |
| `src/lib/ebay/post-order.ts` | eBay Post-Order API client (returns, inquiries, cases, tracking) |
| `src/lib/ebay/token.ts` | eBay OAuth token management |
| `src/app/inventory/page.tsx` | Main inventory dashboard; bucket logic for overdue/delivered/etc. |
| `src/app/inr/page.tsx` | INR cases page |
| `src/app/receiving/page.tsx` | Receiving log page (server component) |
| `src/app/receiving/scan-list.tsx` | Receiving log client component |
| `src/app/api/receiving/scan/route.ts` | Manual scan endpoint |
| `src/app/api/receiving/import-csv/route.ts` | CSV import endpoint |
| `src/components/lot-reconciliation.tsx` | Lot reconciliation modal |
| `src/app/api/reconciliation/[shipmentId]/route.ts` | Reconciliation data API |
| `prisma/schema.prisma` | Database schema |
| `prisma/migrations/` | Migration history |
| `src/worker/index.ts` | BullMQ worker (sync, enrich, returns scrape, snipe, reconcile, alerts) |
| `deploy.sh` | Deploy script (push to GitHub → SSH to VPS → pull → build → systemctl restart) |
| `.ai/DEPLOY_DO_VPS.md` | Step-by-step VPS deploy runbook |
| `/etc/systemd/system/cloudflared.service` | Cloudflare Tunnel systemd unit (VPS only, not in repo) |
| `.env` (VPS only) | Runtime secrets — never committed, backed up at `/root/.arbdesk.env` on VPS |

---

## Deployment Workflow

GitHub (`origin/arbdesk-dev`) → VPS pull → build → `systemctl restart arbdesk arbdesk-worker`

See `.ai/DEPLOY_DO_VPS.md` for exact step-by-step. Quick path:

```bash
bash .ai/verify-branch.sh          # confirm on arbdesk-dev
git push origin arbdesk-dev        # push to GitHub
# Then on VPS (or via deploy.sh):
systemctl restart arbdesk arbdesk-worker
```

The existing `deploy.sh` is the canonical deploy path from Nxcode/local.
