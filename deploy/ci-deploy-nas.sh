#!/usr/bin/env bash
# Run on a Mac (or host) that can reach the Synology over LAN.
# Used by GitHub Actions self-hosted runners labeled synology-lan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_SSH_USER:-rsavige}@${DEPLOY_SSH_HOST:-192.168.1.165}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/volume1/docker/waypoint}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519_nas}"
SSH=(ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY")
RSYNC=(rsync -az --delete
  --exclude .git
  --exclude node_modules
  --exclude dist
  --exclude .DS_Store
  --exclude pocketbase/pb_data
  --exclude .env
  --exclude .env.local
  --exclude .env.*.local
  --exclude deploy/.env.production
)

echo "==> Sync $ROOT → $REMOTE:$REMOTE_DIR"
"${RSYNC[@]}" -e "${SSH[*]}" "$ROOT/" "$REMOTE:$REMOTE_DIR/"

echo "==> Build + recreate containers on NAS"
# Live PocketBase is waypoint-pb17 (compose container_name conflicts / Synology btrfs
# recreate bugs). Rebuild images, recreate SPA via compose, recreate PB by name.
"${SSH[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
export PATH="/usr/local/bin:$PATH"
cd /volume1/docker/waypoint

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  COMPOSE=(docker compose)
fi

ENV_FILE=deploy/.env.production
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE on NAS" >&2
  exit 1
fi

"${COMPOSE[@]}" -f deploy/docker-compose.yml --env-file "$ENV_FILE" build

# SPA / nginx — safe to recreate via compose
"${COMPOSE[@]}" -f deploy/docker-compose.yml --env-file "$ENV_FILE" up -d --no-deps --force-recreate waypoint

# PocketBase — keep working container name + mounts used on this NAS
PB_NAME=waypoint-pb17
docker stop "$PB_NAME" 2>/dev/null || true
docker rm "$PB_NAME" 2>/dev/null || true
# shellcheck disable=SC2046
docker run -d \
  --name "$PB_NAME" \
  --restart unless-stopped \
  -p 8090:8090 \
  --env-file "$ENV_FILE" \
  -v /volume1/docker/waypoint/pocketbase/pb_data:/pb/pb_data \
  -v /volume1/docker/waypoint/pocketbase/pb_hooks:/pb/pb_hooks \
  -v /volume1/docker/waypoint/pocketbase/pb_migrations:/pb/pb_migrations \
  waypoint_pocketbase:latest

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|waypoint($|-pb)' || true
REMOTE

echo "==> Deploy finished"
