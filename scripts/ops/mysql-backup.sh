#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/mysql}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/hushle-mysql-$TIMESTAMP.sql.gz"
TEMP_FILE="$OUTPUT_FILE.partial.$$"

# shellcheck source=scripts/ops/lib/backup-env.sh
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"
# shellcheck source=scripts/ops/lib/schema-ops-lock.sh
source "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

acquire_schema_ops_lock "$ROOT_DIR" "mysql-backup"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT

cd "$ROOT_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
  sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip -c > "$TEMP_FILE"

gzip -t "$TEMP_FILE"
mv "$TEMP_FILE" "$OUTPUT_FILE"
trap - EXIT

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$OUTPUT_FILE")" > "$(basename "$OUTPUT_FILE").sha256"
)

release_schema_ops_lock

if [[ "$(read_backup_env_value BACKUP_REMOTE_ENABLED false)" == "true" ]]; then
  REMOTE_PREFIX="$(read_backup_env_value BACKUP_S3_PREFIX hushle)"
  REMOTE_PREFIX="${REMOTE_PREFIX%/}"
  REMOTE_KEY="$REMOTE_PREFIX/mysql/$(basename "$OUTPUT_FILE")"
  "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$OUTPUT_FILE" "$REMOTE_KEY"
  "$ROOT_DIR/scripts/ops/object-storage.sh" upload "$OUTPUT_FILE.sha256" "$REMOTE_KEY.sha256"
  echo "Offsite backup verified at s3://$(read_backup_env_value BACKUP_S3_BUCKET)/$REMOTE_KEY"
fi

find "$BACKUP_DIR" -type f \( -name 'hushle-mysql-*.sql.gz' -o -name 'hushle-mysql-*.sql.gz.sha256' \) -mtime +"$RETENTION_DAYS" -delete

echo "Backup written to $OUTPUT_FILE"
echo "Checksum written to $OUTPUT_FILE.sha256"
