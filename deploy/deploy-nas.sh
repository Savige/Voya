#!/usr/bin/env bash
# Manual deploy: sync this Mac → Synology and rebuild Waypoint containers.
# LAN only — not used by GitHub Actions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_SSH_USER:-rsavige}@${DEPLOY_SSH_HOST:-192.168.1.165}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/volume1/docker/waypoint}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519_nas}"
SSH=(ssh -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY")

echo "==> Sync $ROOT → $REMOTE:$REMOTE_DIR"
"${SSH[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR'"

# macOS openrsync cannot talk to Synology rsync over SSH — tar stream, then
# local rsync on the NAS. Leave pb_data, secrets, and root-owned build dirs alone.
COPYFILE_DISABLE=1 tar czf - \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude .DS_Store \
  --exclude pocketbase/pb_data \
  --exclude .env \
  --exclude .env.local \
  --exclude 'deploy/.env.production' \
  -C "$ROOT" . \
| "${SSH[@]}" "$REMOTE" \
  "rm -rf /tmp/waypoint-incoming && mkdir -p /tmp/waypoint-incoming && tar xzf - -C /tmp/waypoint-incoming && /usr/bin/rsync -a --delete --exclude pocketbase/pb_data --exclude deploy/.env.production --exclude .env --exclude node_modules --exclude dist /tmp/waypoint-incoming/ '$REMOTE_DIR/' && rm -rf /tmp/waypoint-incoming"

echo "==> Build + recreate containers on NAS"
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

# Tag images the way this NAS already runs them
docker tag deploy_waypoint:latest waypoint_waypoint:latest 2>/dev/null || true
docker tag deploy_pocketbase:latest waypoint_pocketbase:latest 2>/dev/null || true

# SPA / nginx — container name "waypoint" may belong to another compose project
docker rm -f waypoint 2>/dev/null || true
docker run -d \
  --name waypoint \
  --restart unless-stopped \
  -p 8081:80 \
  waypoint_waypoint:latest

# PocketBase — Synology btrfs often leaves old containers stuck in "Removal In
# Progress", so always start a fresh name and stop any currently running pb.
while read -r c; do
  [[ -n "$c" ]] || continue
  docker stop "$c" 2>/dev/null || true
done < <(docker ps --filter name='^waypoint-pb' --format '{{.Names}}')
PB_NAME="waypoint-pb$(date +%y%m%d%H%M)"
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

echo "==> Deploy finished — https://waypoint.savige.me"
