#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz|s3://bucket/key.sql.gz>" >&2
  echo "       $0 --preflight   # only validate RESTORE_DATABASE and its emptiness" >&2
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

case "${RESTORE_DATABASE,,}" in
  mysql | sys | information_schema | performance_schema)
    echo "Refusing to restore into the MySQL system schema $RESTORE_DATABASE." >&2
    exit 1
    ;;
esac

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

restore_target_mysql() {
  if [[ "${RESTORE_USE_ROOT:-false}" == "true" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
      sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$@"' sh "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
      sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" "$@"' sh "$@"
  fi
}

# The dump drops and recreates only its own tables, so restoring into a used
# database would silently mix data. An existing table needs explicit consent.
check_restore_target() {
  local state
  local -a counts
  if ! state="$(
    restore_target_mysql -N -B -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$RESTORE_DATABASE'; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$RESTORE_DATABASE';"
  )"; then
    echo "Could not inspect the restore target database $RESTORE_DATABASE." >&2
    exit 1
  fi
  read -r -d '' -a counts <<<"${state//$'\r'/}" || true
  if [[ "${#counts[@]}" -ne 2 || ! "${counts[0]}" =~ ^[0-9]+$ || ! "${counts[1]}" =~ ^[0-9]+$ ]]; then
    echo "Unexpected answer while inspecting the restore target database." >&2
    exit 1
  fi
  if [[ "${counts[0]}" != "1" ]]; then
    echo "Restore target database $RESTORE_DATABASE does not exist or is not accessible. Create it first (docs/deploy/mysql-backups.md)." >&2
    exit 1
  fi
  if (( counts[1] > 0 )) && [[ "${RESTORE_OVERWRITE_CONFIRM:-}" != "$RESTORE_DATABASE" ]]; then
    echo "Restore target database $RESTORE_DATABASE is not empty (${counts[1]} tables). Use a new empty database, or set RESTORE_OVERWRITE_CONFIRM=$RESTORE_DATABASE to replace its tables." >&2
    exit 1
  fi
}

if [[ "$BACKUP_SOURCE" == "--preflight" ]]; then
  check_restore_target
  echo "Restore target $RESTORE_DATABASE passed preflight."
  exit 0
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

if [[ -n "${BACKUP_EXPECTED_SHA256:-}" || -f "$BACKUP_FILE.sha256" ]]; then
  # data-restore.sh passes the hash of a dump it already verified against the snapshot manifest.
  if [[ -n "${BACKUP_EXPECTED_SHA256:-}" ]]; then
    EXPECTED_HASH="$BACKUP_EXPECTED_SHA256"
  else
    EXPECTED_HASH="$(awk 'NF { print $1; exit }' "$BACKUP_FILE.sha256")"
  fi
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

check_restore_target
gunzip -c "$BACKUP_FILE" | restore_target_mysql "$RESTORE_DATABASE"
