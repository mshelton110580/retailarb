#!/bin/bash
# Quick rebuild — syncs code, builds on server, restarts.
# Skips npm ci (no dependency changes). Use deploy.sh for full deploys.
set -e

SERVER="root@68.183.121.176"
SSH_KEY="$HOME/.ssh/temp_do_key2"
REMOTE_DIR="/opt/retailarb"

echo "==> Syncing code..."
rsync -az --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='storage' \
  -e "ssh -i $SSH_KEY" \
  /workspace/retailarb/ $SERVER:$REMOTE_DIR/

echo "==> Building..."
ssh -i $SSH_KEY $SERVER "cd $REMOTE_DIR && npx prisma generate && npm run build"

echo "==> Restarting..."
ssh -i $SSH_KEY $SERVER "systemctl restart arbdesk && sleep 2 && systemctl is-active arbdesk"

echo "==> Done!"
