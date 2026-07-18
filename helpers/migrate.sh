#!/usr/bin/env bash
# Apply helpers/schema.sql to the linkrowth Postgres instance.
#
# Usage (from repo root):
#   ./helpers/migrate.sh              # idempotent apply (fresh or already matching)
#   ./helpers/migrate.sh --reset      # drop API/legacy tables, then apply
#   DATABASE_URL=postgresql://... ./helpers/migrate.sh
#
# On first Postgres boot, schema.sql is also applied via docker-entrypoint-initdb.d
# (see docker-compose.yml). Use this script to re-apply or after wiping an old volume.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="${ROOT_DIR}/helpers/schema.sql"
RESET=0

for arg in "$@"; do
  case "${arg}" in
    --reset) RESET=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: $0 [--reset]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "Schema file not found: ${SCHEMA_FILE}" >&2
  exit 1
fi

RESET_SQL="$(cat <<'SQL'
DROP TABLE IF EXISTS suggestion_runs CASCADE;
DROP TABLE IF EXISTS suggestion_jobs CASCADE;
DROP TABLE IF EXISTS feed_posts CASCADE;
DROP TABLE IF EXISTS runs CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
SQL
)"

run_psql() {
  local input="$1"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${input}"
  else
    docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
      psql -U linkrowth -d linkrowth -v ON_ERROR_STOP=1 -c "${input}"
  fi
}

run_psql_file() {
  local file="$1"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  else
    docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
      psql -U linkrowth -d linkrowth -v ON_ERROR_STOP=1 < "${file}"
  fi
}

ensure_target() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "Migrating via DATABASE_URL..."
    return
  fi
  if docker compose -f "${ROOT_DIR}/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx postgres; then
    echo "Migrating via docker compose postgres..."
    return
  fi
  echo "No DATABASE_URL set and postgres container is not running." >&2
  echo "Start it with: docker compose up -d postgres" >&2
  exit 1
}

ensure_target

if [[ "${RESET}" -eq 1 ]]; then
  echo "Resetting tables (posts, suggestion_jobs, suggestion_runs, legacy feed_posts/runs)..."
  run_psql "${RESET_SQL}"
fi

if ! run_psql_file "${SCHEMA_FILE}"; then
  echo >&2
  echo "Migration failed. If an older schema is in the way, re-run with:" >&2
  echo "  ./helpers/migrate.sh --reset" >&2
  echo "Or wipe the volume and recreate:" >&2
  echo "  docker compose down -v && docker compose up -d" >&2
  exit 1
fi

echo "Migration complete: posts, suggestion_jobs, suggestion_runs ready."
