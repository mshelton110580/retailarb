#!/bin/bash
# Deploy script for arbdesk environments
# Usage:
#   ./deploy.sh dev        — deploy arbdesk-dev branch to dev environment
#   ./deploy.sh staging    — merge dev→staging and deploy
#   ./deploy.sh production — merge staging→main, backup DB, and deploy
set -e

ENV="${1:-dev}"

case "$ENV" in
  dev)
    DIR="/opt/retailarb-dev"
    BRANCH="arbdesk-dev"
    SERVICES="arbdesk-dev arbdesk-dev-worker"
    ;;
  staging)
    DIR="/opt/retailarb-staging"
    BRANCH="staging"
    SERVICES="arbdesk-staging arbdesk-staging-worker"
    ;;
  production|prod)
    DIR="/opt/retailarb"
    BRANCH="main"
    SERVICES="arbdesk arbdesk-worker"
    ;;
  *)
    echo "Usage: $0 {dev|staging|production}"
    exit 1
    ;;
esac

echo "==> Deploying to $ENV ($DIR on branch $BRANCH)"

# For staging: merge dev into staging first
if [ "$ENV" = "staging" ]; then
  echo "--- Merging arbdesk-dev into staging..."
  cd /opt/retailarb-dev
  git push origin arbdesk-dev
  cd "$DIR"
  git fetch origin
  git merge origin/arbdesk-dev --no-edit
  git push origin staging
fi

# For production: merge staging into main + backup DB first
if [ "$ENV" = "production" ] || [ "$ENV" = "prod" ]; then
  echo "--- Backing up production database..."
  mkdir -p /root/backups
  sudo -u postgres pg_dump arbdesk > "/root/backups/arbdesk_pre_deploy_$(date +%Y%m%d_%H%M%S).sql" 2>/dev/null
  echo "    Backup saved to /root/backups/"

  echo "--- Merging staging into main..."
  cd /opt/retailarb-staging
  git push origin staging
  cd "$DIR"
  git fetch origin
  git merge origin/staging --no-edit
  git push origin main
fi

cd "$DIR"

# For dev: just pull latest
if [ "$ENV" = "dev" ]; then
  git fetch origin
  git reset --hard "origin/$BRANCH"
fi

echo "--- Ensuring .env exists..."
[ -f .env ] && echo "    .env present" || (echo "ERROR: .env missing in $DIR" && exit 1)

echo "--- Installing dependencies..."
npm ci --legacy-peer-deps

echo "--- Generating Prisma client..."
npx prisma generate

echo "--- Running database migrations..."
npx prisma migrate deploy

echo "--- Building..."
npm run build

echo "--- Restarting services..."
systemctl restart $SERVICES
sleep 3

for SVC in $SERVICES; do
  if systemctl is-active --quiet "$SVC"; then
    echo "    ✓ $SVC is running"
  else
    echo "    ✗ $SVC FAILED to start"
    systemctl status "$SVC" --no-pager | tail -5
    exit 1
  fi
done

echo "==> Deploy to $ENV complete!"
