# RUNBOOK — Arbdesk Restart Recovery & Operations

---

## Restart Recovery Checklist

Work through each step in order before touching any code or making any changes.

### 1. Verify GitHub Access
```bash
git -C /workspace/retailarb fetch origin
git -C /workspace/retailarb branch -r | grep arbdesk-dev
# Expected: origin/arbdesk-dev appears
```

### 2. Verify SSH Access to VPS
```bash
ssh arbdesk "echo OK && git -C /opt/retailarb branch --show-current"
# Expected: OK\narbdesk-dev
```

### 3. Verify Branch (REQUIRED before any commit or deploy)
```bash
cd /workspace/retailarb
bash .ai/verify-branch.sh
# Expected: "OK: On branch arbdesk-dev"
# If fails: git checkout arbdesk-dev && git reset --hard origin/arbdesk-dev
```

### 4. Confirm Clean Working Tree
```bash
git -C /workspace/retailarb status
# Expected: "nothing to commit, working tree clean"
# If not clean: review uncommitted changes before proceeding
```

### 5. Smoke Test (Local Build)
```bash
cd /workspace/retailarb
npm run build 2>&1 | grep -E "✓ Compiled|error TS|Type error|Failed"
# Expected: "✓ Compiled successfully"
```

### 6. VPS Health Check
```bash
ssh arbdesk "systemctl is-active arbdesk arbdesk-worker && curl -s http://localhost:3000/ -o /dev/null -w '%{http_code}'"
# Expected: active\nactive\n200
```

### 7. Read Context Files
```bash
# Read current state before starting work:
cat /workspace/retailarb/.ai/STATUS.md
cat /workspace/retailarb/.ai/REHYDRATE.md
```

---

## Branch Drift Prevention

### Rules (non-negotiable)

- **Do NOT create `arbdesk-sync`** — this branch was accidentally created once and caused confusion. It no longer exists and must never be recreated.
- **Do NOT create any new branches** — all work happens on `arbdesk-dev`.
- **Do NOT rename branches** — `arbdesk-dev` is the working branch; `main` is the stable baseline.
- If any tool, script, or AI action attempts to create `arbdesk-sync` or any other branch, **abort immediately** and return to `arbdesk-dev`.

### Recovery if wrong branch detected
```bash
git checkout arbdesk-dev
git reset --hard origin/arbdesk-dev
bash .ai/verify-branch.sh
```

### What happened before (do not repeat)
A branch `arbdesk-sync` was created as a "staging" step. This caused deploy confusion
because Nxcode has a strict single-branch workflow. The branch was deleted. The correct
workflow is: make changes on `arbdesk-dev` → commit → push → deploy from `arbdesk-dev`.

---

## Common Operations

### Deploy to VPS
See `.ai/DEPLOY_DO_VPS.md` for the full runbook. Quick path:
```bash
bash .ai/verify-branch.sh
git push origin arbdesk-dev
# Then SSH to VPS and run:
ssh arbdesk "cd /opt/retailarb && git reset --hard origin/arbdesk-dev && npm ci --legacy-peer-deps && npx prisma generate && npm run build && systemctl restart arbdesk arbdesk-worker"
```

### Restart App on VPS (after deploy)
```bash
ssh arbdesk "systemctl restart arbdesk arbdesk-worker && sleep 3 && systemctl is-active arbdesk"
```

### Check VPS Logs
```bash
ssh arbdesk "journalctl -u arbdesk -n 50 --no-pager"
ssh arbdesk "journalctl -u arbdesk-worker -n 50 --no-pager"
```

### Trigger INR/Returns Sync
Log into the app at `http://68.183.121.176:3000` and click the sync button,
or hit `POST /api/sync/returns` with a valid session cookie.

### Run DB Migration on VPS
```bash
ssh arbdesk "cd /opt/retailarb && npx prisma migrate deploy"
```
