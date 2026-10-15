#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"
# Created by the operator account so later steps (tar, upload) can read them.
mkdir -p "$ROOT_DIR/backups/.locks" "$ROOT_DIR/backups/staging" "$ROOT_DIR/backups/data"
exec 9>"$ROOT_DIR/backups/.locks/data-backup.lock"
flock -n 9 || { echo "Another data backup is running" >&2; exit 1; }
ASSETS="$(read_backup_env_value ASSET_STORAGE_HOST_PATH "$ROOT_DIR/data/assets")"
[[ "$ASSETS" = /* ]] || ASSETS="$ROOT_DIR/$ASSETS"
[[ -d "$ASSETS" ]] || { echo "Asset storage directory is missing: $ASSETS" >&2; exit 1; }
ASSETS="$(cd "$ASSETS" && pwd -P)"
STAGING_DIR="$ROOT_DIR/backups/staging"
DB_FILE="$STAGING_DIR/hushle-mysql-$(date -u +%Y%m%dT%H%M%SZ)-$$.sql.gz"
ARCHIVE=""
cleanup() {
  # The dump lives on inside the snapshot; the upload archive is only transport.
  rm -f "$DB_FILE" "$DB_FILE.sha256"
  if [[ -n "$ARCHIVE" ]]; then
    rm -f "$ARCHIVE.partial" "$ARCHIVE" "$ARCHIVE.sha256"
  fi
}
trap cleanup EXIT
# The snapshot archive carries the dump offsite, so the inner DB backup stays local.
ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" BACKUP_DIR="$STAGING_DIR" OUTPUT_FILE="$DB_FILE" \
  RETENTION_DAYS=0 BACKUP_REMOTE_ENABLED=false \
  bash "$ROOT_DIR/scripts/ops/mysql-backup.sh"
(cd "$STAGING_DIR" && sha256sum --check --quiet "$(basename "$DB_FILE").sha256")
# Root inside the helper reads app-owned (root, 0600) assets; the finished
# snapshot is handed to the account running this script.
BACKUP_PATH="$(docker run --rm --network none \
  -e BACKUP_OWNER="$(id -u):$(id -g)" \
  -v "$ROOT_DIR/scripts/ops/data-backup.mjs:/tool/data-backup.mjs:ro" \
  -v "$ASSETS:/assets:ro" -v "$ROOT_DIR/backups:/backups" \
  node:20-alpine sh -c 'set -e
    snapshot="$(node /tool/data-backup.mjs create --assets /assets --output /backups/data --db-file "$1")"
    chown -R "$BACKUP_OWNER" "$snapshot"
    printf "%s\n" "$snapshot"' sh "/backups/staging/$(basename "$DB_FILE")")"
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
  REMOTE_KEY="${PREFIX%/}/data/$NAME.tar.gz"
  bash "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$ARCHIVE" "$REMOTE_KEY"
  # The sidecar goes last: restore and listing treat an archive without it as incomplete.
  bash "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$ARCHIVE.sha256" "$REMOTE_KEY.sha256"
  echo "Offsite snapshot uploaded (size checked) to s3://$(read_backup_env_value BACKUP_S3_BUCKET)/$REMOTE_KEY"
fi
