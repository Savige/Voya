#!/usr/bin/env bash
# Run on the server from a git clone of this repo (e.g. ./deploy/deploy.sh).
# Pulls latest code and rebuilds the Waypoint Docker image.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${ENV_FILE:-}" ]]; then
  if [[ -f "$ROOT/deploy/.env" ]]; then
    ENV_FILE="deploy/.env"
  else
    ENV_FILE="deploy/.env.production"
  fi
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/.env.production.example to deploy/.env (or deploy/.env.production) and configure VITE_* keys." >&2
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: $ROOT" >&2
  exit 1
fi

echo "Deploying from $ROOT (branch: $BRANCH)"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.yml --env-file "$ENV_FILE" up -d --build

echo "Deploy finished."
