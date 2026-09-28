#!/usr/bin/env bash
set -euo pipefail

if [[ "${OFFSITE_BACKUP_INTEGRATION_TEST:-false}" != "true" && "${1:-}" != "--run" ]]; then
  echo "Skipped. Set OFFSITE_BACKUP_INTEGRATION_TEST=true or pass --run."
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

export ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.example}"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
export BACKUP_DIR="$TEMP_DIR"
export BACKUP_REMOTE_ENABLED=false

"$ROOT_DIR/scripts/ops/mysql-backup.sh"
BACKUP_FILE="$(find "$TEMP_DIR" -maxdepth 1 -type f -name 'hushle-mysql-*.sql.gz' | head -1)"

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "Integration backup or checksum was not created." >&2
  exit 1
fi

"$ROOT_DIR/scripts/ops/mysql-restore-smoke.sh" "$BACKUP_FILE"

echo "Offsite backup MySQL integration checks passed."
