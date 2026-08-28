#!/usr/bin/env bash
# Apply ordered seed SQL files separately from schema migrations.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEEDS_DIR="${ROOT_DIR}/db/seeds"

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
  echo "Seeding via DATABASE_URL..."
elif docker compose -f "${ROOT_DIR}/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "Seeding via docker compose postgres..."
else
  echo "No DATABASE_URL set and postgres container is not running." >&2
  echo "Start it with: docker compose up -d postgres" >&2
  exit 1
fi

shopt -s nullglob
seeds=("${SEEDS_DIR}"/*.sql)
if [[ "${#seeds[@]}" -eq 0 ]]; then
  echo "No seed files found; nothing to do."
  exit 0
fi

for seed in "${seeds[@]}"; do
  echo "Applying seed $(basename "${seed}")..."
  run_psql_file "${seed}"
done

echo "Seed complete."
