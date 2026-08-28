#!/usr/bin/env bash
# Apply ordered, idempotent migrations to Linkrowth Postgres.
# Usage: ./db/scripts/migrate.sh [--reset]

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/db/migrations"
RESET_FILE="${ROOT_DIR}/db/scripts/reset.sql"
RESET=0

for arg in "$@"; do
  case "${arg}" in
    --reset) RESET=1 ;;
    -h|--help)
      echo "Usage: $0 [--reset]"
      exit 0
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: $0 [--reset]" >&2
      exit 1
      ;;
  esac
done

run_psql_file() {
  local file="$1"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
  else
    docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
      psql -U linkrowth -d linkrowth -v ON_ERROR_STOP=1 < "${file}"
  fi
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Migrating via DATABASE_URL..."
elif docker compose -f "${ROOT_DIR}/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "Migrating via docker compose postgres..."
else
  echo "No DATABASE_URL set and postgres container is not running." >&2
  echo "Start it with: docker compose up -d postgres" >&2
  exit 1
fi

if [[ "${RESET}" -eq 1 ]]; then
  echo "Resetting Linkrowth and legacy tables..."
  run_psql_file "${RESET_FILE}"
fi

shopt -s nullglob
migrations=("${MIGRATIONS_DIR}"/*.sql)
if [[ "${#migrations[@]}" -eq 0 ]]; then
  echo "No migrations found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

for migration in "${migrations[@]}"; do
  echo "Applying $(basename "${migration}")..."
  run_psql_file "${migration}"
done

echo "Migration complete: posts, suggestion_jobs, suggestion_runs ready."
