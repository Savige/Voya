#!/usr/bin/env bash
# Apply supabase/migrations/001_user_trips_and_profiles.sql to the self-hosted Supabase Postgres container.
# Prerequisites: official Supabase docker stack is running; docker compose v2.
#
# Usage:
#   export SUPABASE_DOCKER_DIR=/opt/supabase/docker
#   ./deploy/apply-migration.sh
#
# Default database name is "postgres" (override with POSTGRES_DB if your .env differs).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPABASE_DOCKER_DIR="${SUPABASE_DOCKER_DIR:-/opt/supabase/docker}"
MIGRATION="$REPO_ROOT/supabase/migrations/001_user_trips_and_profiles.sql"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

if [[ ! -d "$SUPABASE_DOCKER_DIR" ]]; then
  echo "Directory not found: $SUPABASE_DOCKER_DIR" >&2
  echo "Clone https://github.com/supabase/supabase and set SUPABASE_DOCKER_DIR to the docker/ path." >&2
  exit 1
fi

if [[ ! -f "$MIGRATION" ]]; then
  echo "Migration file not found: $MIGRATION" >&2
  exit 1
fi

cd "$SUPABASE_DOCKER_DIR"
echo "Applying migration to db service (database: $POSTGRES_DB)..."
docker compose exec -T db psql -U postgres -d "$POSTGRES_DB" <"$MIGRATION"
echo "Done."
