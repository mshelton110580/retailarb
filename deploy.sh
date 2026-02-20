#!/bin/bash
# Deploy script for arbdesk (retailarb)
# .env is EXCLUDED from rsync — it lives only on the server.
# Backup is kept at /root/.arbdesk.env on the server.
# A copy of all secrets is stored as GitHub Actions secret ENV_FILE.
set -e

SERVER="root@68.183.121.176"
SSH_KEY="$HOME/.ssh/temp_do_key2"
REMOTE_DIR="/opt/retailarb"

echo "==> Syncing files (excluding .env and uploaded photos)..."
rsync -avz --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='storage' \
  --exclude='public/uploads' \
  -e "ssh -i $SSH_KEY" \
  /workspace/retailarb/ $SERVER:$REMOTE_DIR/

echo "==> Ensuring uploads directory exists on server..."
ssh -i $SSH_KEY $SERVER "mkdir -p $REMOTE_DIR/public/uploads"

echo "==> Ensuring .env exists on server (restoring from backup if needed)..."
ssh -i $SSH_KEY $SERVER \
  "[ -f $REMOTE_DIR/.env ] && echo '.env present' || (cp /root/.arbdesk.env $REMOTE_DIR/.env && echo 'Restored .env from /root/.arbdesk.env backup')"

echo "==> Installing dependencies and building..."
ssh -i $SSH_KEY $SERVER \
  "cd $REMOTE_DIR && npm ci --legacy-peer-deps && npx prisma generate && npm run build"

echo "==> Restarting service..."
ssh -i $SSH_KEY $SERVER \
  "systemctl restart arbdesk && sleep 3 && systemctl is-active arbdesk"

echo "==> Deploy complete!"
