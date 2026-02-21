#!/bin/bash
# Deploy script for arbdesk (retailarb)
# Pushes current branch to GitHub, then pulls on the server and builds.
# .env is EXCLUDED from git — it lives only on the server.
set -e

SERVER="root@68.183.121.176"
SSH_KEY="$HOME/.ssh/temp_do_key2"
REMOTE_DIR="/opt/retailarb"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "==> Pushing branch '$BRANCH' to GitHub..."
git push origin "$BRANCH"

COMMIT=$(git rev-parse --short HEAD)
echo "==> Deploying commit $COMMIT to server..."

ssh -i "$SSH_KEY" "$SERVER" bash <<EOF
set -e
cd $REMOTE_DIR

echo "--- Fetching from GitHub..."
git fetch origin

echo "--- Checking out branch '$BRANCH' and resetting to origin..."
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "--- Ensuring uploads directory exists..."
mkdir -p public/uploads

echo "--- Ensuring .env exists (restoring from backup if needed)..."
[ -f .env ] && echo ".env present" || (cp /root/.arbdesk.env .env && echo "Restored .env from backup")

echo "--- Installing dependencies..."
npm ci --legacy-peer-deps

echo "--- Generating Prisma client..."
npx prisma generate

echo "--- Building..."
npm run build

echo "--- Restarting services..."
systemctl restart arbdesk arbdesk-worker
sleep 3
systemctl is-active arbdesk
systemctl is-active arbdesk-worker
EOF

echo "==> Deploy complete! Server is on commit $COMMIT (branch: $BRANCH)"
