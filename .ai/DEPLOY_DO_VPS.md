# DEPLOY — DigitalOcean VPS (arbdesk)

**VPS**: `root@68.183.121.176` (SSH alias: `arbdesk`)
**Deploy dir**: `/opt/retailarb`
**Services**: `arbdesk` (Next.js app, port 3000) + `arbdesk-worker` (BullMQ worker)
**Env file**: `/opt/retailarb/.env` (not in git; backed up at `/root/.arbdesk.env`)

---

## Pre-Deploy Checklist

Run these BEFORE touching the VPS:

```bash
# 1. Confirm on correct branch
bash .ai/verify-branch.sh
# Must output: "OK: On branch arbdesk-dev"

# 2. Confirm local build is clean
npm run build 2>&1 | grep -E "✓ Compiled|error TS|Type error|Failed"
# Must output: "✓ Compiled successfully"

# 3. Push to GitHub (source of truth)
git push origin arbdesk-dev
```

---

## Full Deploy Steps (VPS)

```bash
# Step 1: SSH into VPS
ssh arbdesk

# Step 2: Navigate to deploy directory
cd /opt/retailarb

# Step 3: Verify branch guardrail (REQUIRED before any destructive operation)
bash .ai/verify-branch.sh
# If this fails: git checkout arbdesk-dev

# Step 4: Fetch latest from GitHub
git fetch origin

# Step 5: Reset to origin/arbdesk-dev (DESTRUCTIVE — discards any local VPS changes)
git reset --hard origin/arbdesk-dev

# Step 6: Verify .env is present
[ -f .env ] && echo ".env OK" || (cp /root/.arbdesk.env .env && echo "Restored .env from backup")

# Step 7: Install dependencies
npm ci --legacy-peer-deps

# Step 8: Generate Prisma client
npx prisma generate

# Step 9: Run any pending migrations (if schema changed)
npx prisma migrate deploy

# Step 10: Build
npm run build

# Step 11: Restart services via systemd
systemctl restart arbdesk arbdesk-worker

# Step 12: Health check
sleep 3
systemctl is-active arbdesk
systemctl is-active arbdesk-worker
curl -s http://localhost:3000/ -o /dev/null -w "HTTP %{http_code}\n"
```

---

## One-Liner Deploy (from Nxcode after push)

```bash
ssh arbdesk "cd /opt/retailarb && bash .ai/verify-branch.sh && git fetch origin && git reset --hard origin/arbdesk-dev && [ -f .env ] || cp /root/.arbdesk.env .env && npm ci --legacy-peer-deps && npx prisma generate && npm run build && systemctl restart arbdesk arbdesk-worker && sleep 3 && systemctl is-active arbdesk && curl -s http://localhost:3000/ -o /dev/null -w 'HTTP %{http_code}'"
```

---

## Restart Only (no code change)

```bash
ssh arbdesk "systemctl restart arbdesk arbdesk-worker && sleep 3 && systemctl is-active arbdesk arbdesk-worker"
```

---

## Check Logs

```bash
# App logs (last 50 lines)
ssh arbdesk "journalctl -u arbdesk -n 50 --no-pager"

# Worker logs
ssh arbdesk "journalctl -u arbdesk-worker -n 50 --no-pager"

# Follow live
ssh arbdesk "journalctl -u arbdesk -f"
```

---

## Known State Issues

- If `arbdesk` systemd service appears stopped but port 3000 is in use, a manual
  `nohup npm exec next start` process may be running. Kill it before using systemctl:
  ```bash
  ssh arbdesk "fuser -k 3000/tcp; sleep 1 && systemctl restart arbdesk"
  ```

---

## Rollback

```bash
ssh arbdesk "cd /opt/retailarb && git log --oneline -5"
# Find the last good commit hash, then:
ssh arbdesk "cd /opt/retailarb && git reset --hard <commit> && npm run build && systemctl restart arbdesk arbdesk-worker"
```

---

## No Docker Compose in Production

`docker-compose.yml` exists in the repo but is **not used in production**.
Production uses systemd services `arbdesk` and `arbdesk-worker` directly on the host.
Docker Compose is available for local development only.
