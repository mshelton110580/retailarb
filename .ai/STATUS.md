# STATUS — Arbdesk

Update 3–6 lines per work session. Keep it brief and current.

---

## Last Completed
- **INR delivery sync fix** — `02-14043-95213` now shows `derived_status=delivered` after sync (commit `afba73e`)
  - `upsertInquiry()` in `sync/returns/route.ts` now sets both `delivered_at` and `derived_status="delivered"`
    in one write when tracking shows `DELIVERED` and case is closed/expired
  - Delivery date sourced from the "Case expired." history event (the INR close timestamp)
  - Fix is stable across repeated syncs: order sync runs first (wipes to null), then INR sync sets final state
- Debug logging removed (was added in `eaa7bed`)
- All services running via systemd (`arbdesk`, `arbdesk-worker`, `cloudflared`)

## In Progress
- Nothing active

## Next Up
- Nothing queued

## Known Issues
- None currently

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
