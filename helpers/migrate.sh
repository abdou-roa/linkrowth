#!/usr/bin/env bash
# Backward-compatible entrypoint for the united DB package migration runner.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT_DIR}/db/scripts/migrate.sh" "$@"
