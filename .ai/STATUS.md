# STATUS — Arbdesk

Update 3–6 lines per work session. Keep it brief and current.

---

## Last Completed
- Multi-qty lot detection fixed in scan + import-csv routes (lots like 2×6 now correctly detected)
- Receiving log displays "2 lots × 6 units (12 total)" for multi-qty orders
- Delete button added for CSV-imported receiving entries
- Lot grouping headers added to reconciliation UI
- All `possible_chargeback` changes reverted; codebase stable at pre-chargeback baseline
- `.ai/` scaffolding created (REHYDRATE, RUNBOOK, STATUS, DEPLOY_DO_VPS, verify-branch.sh)

## In Progress
- **INR delivery sync fix**: `upsertInquiry()` in `src/app/api/sync/returns/route.ts` needs
  to correctly extract `delivered_at` from eBay Post-Order API full inquiry response.
  Debug logging added (commit `eaa7bed`) — **must be removed before shipping fix**.
  Target order: `02-14043-95213`, inquiry ID `5372054673`.
  The full API response structure is not yet confirmed — sync needs to run with debug
  logging active to capture the real response shape.

## Next Up
1. Capture live inquiry response from eBay API (trigger sync with debug logging active)
2. Identify correct field path for delivery date in full inquiry response
3. Fix `upsertInquiry()` to extract delivery date and write to `shipments.delivered_at`
4. Remove debug logging, commit, push, deploy
5. Verify `02-14043-95213` shows `derived_status=delivered` after sync

## Known Issues
- `arbdesk` systemd service is currently **stopped** — app running via manual `nohup` process.
  Next deploy must use `systemctl restart arbdesk` to restore proper service management.
- Debug logging in `src/app/api/sync/returns/route.ts` (commit `eaa7bed`) must be removed.
- VPS app is currently serving the **debug build** (not clean).

## How to Test
```bash
# Build check
cd /workspace/retailarb && npm run build 2>&1 | grep -E "✓ Compiled|error TS|Failed"

# VPS health
ssh arbdesk "curl -s http://localhost:3000/ -o /dev/null -w '%{http_code}'"

# Verify delivery fix (after sync)
ssh arbdesk "cd /opt/retailarb && node -e \"
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
p.shipments.findFirst({where:{order_id:'02-14043-95213'},select:{derived_status:true,delivered_at:true}}).then(r=>console.log(JSON.stringify(r))).finally(()=>p.\$disconnect());
\""
```
