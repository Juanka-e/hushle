#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/mysql}"
SMOKE_DATABASE="hushle_restore_smoke_$(date -u +%Y%m%d%H%M%S)_$$"

if [[ $# -eq 0 ]]; then
  BACKUP_SOURCE="$(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hushle-mysql-*.sql.gz' \
      -printf '%T@ %p\n' \
      | sort -nr \
      | head -1 \
      | cut -d' ' -f2-
  )"
  if [[ -z "$BACKUP_SOURCE" ]]; then
    echo "No local MySQL backup found under $BACKUP_DIR." >&2
    exit 1
  fi
elif [[ $# -eq 1 ]]; then
  BACKUP_SOURCE="$1"
else
  echo "Usage: $0 [backup-file.sql.gz|s3://bucket/key.sql.gz]" >&2
  exit 1
fi

cleanup() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    -e SMOKE_DATABASE="$SMOKE_DATABASE" mysql \
    sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS \`$SMOKE_DATABASE\`"' \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
  -e SMOKE_DATABASE="$SMOKE_DATABASE" mysql \
  sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE \`$SMOKE_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"'

RESTORE_DATABASE="$SMOKE_DATABASE" RESTORE_USE_ROOT=true \
  "$ROOT_DIR/scripts/ops/mysql-restore.sh" "$BACKUP_SOURCE"

TABLE_COUNT="$(
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    -e SMOKE_DATABASE="$SMOKE_DATABASE" mysql \
    sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -N -uroot -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''$SMOKE_DATABASE'\''"' \
    | tr -d '[:space:]'
)"

if [[ -z "$TABLE_COUNT" || "$TABLE_COUNT" -lt 1 ]]; then
  echo "Restore smoke test failed: restored database has no tables." >&2
  exit 1
fi

echo "Restore smoke test passed with $TABLE_COUNT tables."
