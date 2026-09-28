#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/mysql}"
BACKUP_SOURCE="$1"
BACKUP_REQUIRE_CHECKSUM="${BACKUP_REQUIRE_CHECKSUM:-true}"

# shellcheck source=scripts/ops/lib/backup-env.sh
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"
# shellcheck source=scripts/ops/lib/schema-ops-lock.sh
source "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh"

if [[ -z "${RESTORE_DATABASE:-}" ]]; then
  echo "RESTORE_DATABASE is required. In-place restore to the active database is disabled." >&2
  exit 1
fi

if ! [[ "$RESTORE_DATABASE" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "RESTORE_DATABASE contains unsupported characters." >&2
  exit 1
fi

ACTIVE_DATABASE="$(read_backup_env_value MYSQL_DATABASE)"
if [[ -z "$ACTIVE_DATABASE" ]]; then
  ACTIVE_DATABASE_URL="$(read_backup_env_value DATABASE_URL)"
  ACTIVE_DATABASE_URL="${ACTIVE_DATABASE_URL%%\?*}"
  ACTIVE_DATABASE="${ACTIVE_DATABASE_URL##*/}"
fi
if [[ -z "$ACTIVE_DATABASE" || ! "$ACTIVE_DATABASE" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Could not determine the active database name safely." >&2
  exit 1
fi
if [[ "$RESTORE_DATABASE" == "$ACTIVE_DATABASE" ]]; then
  echo "Refusing to restore over the active database. Restore to an isolated database and use controlled cutover." >&2
  exit 1
fi

if [[ "$RESTORE_DATABASE" != hushle_restore_* && "${RESTORE_TARGET_CONFIRM:-}" != "I_ACCEPT_AN_ISOLATED_RESTORE_TARGET" ]]; then
  echo "Non-standard restore target requires RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET." >&2
  exit 1
fi

if [[ "$BACKUP_SOURCE" == s3://* ]]; then
  REMOTE_BUCKET_AND_KEY="${BACKUP_SOURCE#s3://}"
  REMOTE_BUCKET="${REMOTE_BUCKET_AND_KEY%%/*}"
  REMOTE_KEY="${REMOTE_BUCKET_AND_KEY#*/}"
  CONFIGURED_BUCKET="$(require_backup_env_value BACKUP_S3_BUCKET)"
  if [[ "$REMOTE_BUCKET" != "$CONFIGURED_BUCKET" ]]; then
    echo "Remote restore bucket must match BACKUP_S3_BUCKET." >&2
    exit 1
  fi

  BACKUP_FILE="$BACKUP_DIR/remote/$(basename "$REMOTE_KEY")"
  "$ROOT_DIR/scripts/ops/object-storage.sh" download "$REMOTE_KEY" "$BACKUP_FILE"
  "$ROOT_DIR/scripts/ops/object-storage.sh" download "$REMOTE_KEY.sha256" "$BACKUP_FILE.sha256"
else
  BACKUP_FILE="$BACKUP_SOURCE"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [[ -f "$BACKUP_FILE.sha256" ]]; then
  EXPECTED_HASH="$(awk 'NF { print $1; exit }' "$BACKUP_FILE.sha256")"
  if [[ ! "$EXPECTED_HASH" =~ ^[[:xdigit:]]{64}$ ]]; then
    echo "Checksum file is malformed: $BACKUP_FILE.sha256" >&2
    exit 1
  fi
  ACTUAL_HASH="$(sha256sum "$BACKUP_FILE" | awk '{ print $1 }')"
  if [[ "${ACTUAL_HASH,,}" != "${EXPECTED_HASH,,}" ]]; then
    echo "Checksum verification failed for $BACKUP_FILE" >&2
    exit 1
  fi
  echo "$(basename "$BACKUP_FILE"): checksum verified"
elif [[ "$BACKUP_REQUIRE_CHECKSUM" == "true" ]]; then
  echo "Checksum file not found: $BACKUP_FILE.sha256" >&2
  exit 1
else
  echo "WARNING: restoring legacy backup without checksum verification." >&2
fi

acquire_schema_ops_lock "$ROOT_DIR" "mysql-restore:$RESTORE_DATABASE"

cd "$ROOT_DIR"

if [[ "${RESTORE_USE_ROOT:-false}" == "true" ]]; then
  gunzip -c "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    -e RESTORE_DATABASE="$RESTORE_DATABASE" mysql \
    sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$RESTORE_DATABASE"'
else
  gunzip -c "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    -e RESTORE_DATABASE="$RESTORE_DATABASE" mysql \
    sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" "$RESTORE_DATABASE"'
fi
