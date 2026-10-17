#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"
mkdir -p "$ROOT_DIR/backups/.locks" "$ROOT_DIR/backups/staging"
exec 9>"$ROOT_DIR/backups/.locks/data-backup.lock"
flock -n 9 || { echo "Another data backup is running" >&2; exit 1; }
ASSETS="$(read_backup_env_value ASSET_STORAGE_HOST_PATH "$ROOT_DIR/data/assets")"
[[ "$ASSETS" = /* ]] || ASSETS="$ROOT_DIR/$ASSETS"
[[ -d "$ASSETS" ]] || { echo "Asset storage directory is missing: $ASSETS" >&2; exit 1; }
ASSETS="$(cd "$ASSETS" && pwd -P)"
DB_FILE="$ROOT_DIR/backups/staging/hushle-mysql-$(date -u +%Y%m%dT%H%M%SZ)-$$.sql.gz"
ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" OUTPUT_FILE="$DB_FILE" RETENTION_DAYS=0 \
  bash "$ROOT_DIR/scripts/ops/mysql-backup.sh"
BACKUP_PATH="$(docker run --rm --network none \
  -v "$ROOT_DIR/scripts/ops/data-backup.mjs:/tool/data-backup.mjs:ro" \
  -v "$ASSETS:/assets:ro" -v "$ROOT_DIR/backups:/backups" \
  node:20-alpine node /tool/data-backup.mjs create --assets /assets \
  --output /backups/data --db-file "/backups/staging/$(basename "$DB_FILE")")"
[[ "$BACKUP_PATH" =~ ^/backups/data/hushle-data-[A-Za-z0-9.-]+$ ]] || { echo "Unexpected backup output" >&2; exit 1; }
NAME="$(basename "$BACKUP_PATH")"
LOCAL_PATH="$ROOT_DIR/backups/data/$NAME"
echo "Verified data snapshot: $LOCAL_PATH"
if [[ "$(read_backup_env_value BACKUP_REMOTE_ENABLED false)" == "true" ]]; then
  ARCHIVE="$LOCAL_PATH.tar.gz"
  tar -C "$ROOT_DIR/backups/data" -czf "$ARCHIVE.partial" "$NAME"
  mv "$ARCHIVE.partial" "$ARCHIVE"
  (cd "$(dirname "$ARCHIVE")" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
  PREFIX="$(read_backup_env_value BACKUP_S3_PREFIX hushle)"
  bash "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$ARCHIVE" "${PREFIX%/}/data/$NAME.tar.gz"
  bash "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$ARCHIVE.sha256" "${PREFIX%/}/data/$NAME.tar.gz.sha256"
fi
