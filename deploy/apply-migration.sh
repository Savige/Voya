#!/usr/bin/env bash
# Apply supabase/migrations/*.sql in lexicographic order (001, 002, …) to self-hosted Supabase Postgres.
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
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

if [[ ! -d "$SUPABASE_DOCKER_DIR" ]]; then
  echo "Directory not found: $SUPABASE_DOCKER_DIR" >&2
  echo "Clone https://github.com/supabase/supabase and set SUPABASE_DOCKER_DIR to the docker/ path." >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

shopt -s nullglob
mapfile -t FILES < <(printf '%s\n' "$MIGRATIONS_DIR"/*.sql | sort -V)
shopt -u nullglob

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .sql files in $MIGRATIONS_DIR" >&2
  exit 1
fi

cd "$SUPABASE_DOCKER_DIR"
for f in "${FILES[@]}"; do
  echo "Applying $(basename "$f") to db (database: $POSTGRES_DB)..."
  docker compose exec -T db psql -U postgres -d "$POSTGRES_DB" <"$f"
done
echo "Done."
