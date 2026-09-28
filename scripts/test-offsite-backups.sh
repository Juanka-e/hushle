#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

MOCK_ROOT="$TEMP_DIR/remote"
MOCK_CLI="$TEMP_DIR/mock-aws.sh"

cat > "$MOCK_CLI" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

while [[ "${1:-}" == "--no-cli-pager" || "${1:-}" == "--endpoint-url" ]]; do
  if [[ "$1" == "--endpoint-url" ]]; then
    shift 2
  else
    shift
  fi
done

service="$1"
command="$2"
shift 2

if [[ "$service" == "s3" && "$command" == "cp" ]]; then
  source_path="$1"
  destination_path="$2"
  if [[ "$source_path" == s3://* ]]; then
    remote_path="${source_path#s3://}"
    cp "$MOCK_S3_ROOT/$remote_path" "$destination_path"
  else
    remote_path="${destination_path#s3://}"
    mkdir -p "$(dirname "$MOCK_S3_ROOT/$remote_path")"
    cp "$source_path" "$MOCK_S3_ROOT/$remote_path"
  fi
  exit 0
fi

if [[ "$service" == "s3api" && "$command" == "head-object" ]]; then
  bucket=""
  key=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bucket)
        bucket="$2"
        shift 2
        ;;
      --key)
        key="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  wc -c < "$MOCK_S3_ROOT/$bucket/$key" | tr -d '[:space:]'
  exit 0
fi

echo "Unsupported mock AWS command: $service $command" >&2
exit 1
EOF
chmod +x "$MOCK_CLI"

export ENV_FILE="$TEMP_DIR/missing.env"
export MYSQL_DATABASE=hushle
export BACKUP_S3_BUCKET="test-bucket"
export BACKUP_S3_ENDPOINT="https://example.invalid"
export BACKUP_S3_REGION="auto"
export BACKUP_S3_CLI_MODE="host"
export BACKUP_S3_CLI="$MOCK_CLI"
export BACKUP_S3_ACCESS_KEY_ID="test-access"
export BACKUP_S3_SECRET_ACCESS_KEY="test-secret"
export MOCK_S3_ROOT="$MOCK_ROOT"

printf 'verified backup payload\n' > "$TEMP_DIR/backup.sql.gz"
"$ROOT_DIR/scripts/ops/object-storage.sh" upload \
  "$TEMP_DIR/backup.sql.gz" \
  "test/mysql/backup.sql.gz"

test -f "$MOCK_ROOT/test-bucket/test/mysql/backup.sql.gz"
test "$("$ROOT_DIR/scripts/ops/object-storage.sh" size "test/mysql/backup.sql.gz")" = \
  "$(wc -c < "$TEMP_DIR/backup.sql.gz" | tr -d '[:space:]')"

"$ROOT_DIR/scripts/ops/object-storage.sh" download \
  "test/mysql/backup.sql.gz" \
  "$TEMP_DIR/downloaded.sql.gz"
cmp "$TEMP_DIR/backup.sql.gz" "$TEMP_DIR/downloaded.sql.gz"

cat > "$TEMP_DIR/backup.env" <<EOF
BACKUP_S3_BUCKET="test-bucket"
BACKUP_S3_ENDPOINT="https://example.invalid"
BACKUP_S3_REGION="auto"
BACKUP_S3_CLI_MODE="host"
BACKUP_S3_CLI="$MOCK_CLI"
BACKUP_S3_ACCESS_KEY_ID="file-access"
BACKUP_S3_SECRET_ACCESS_KEY="file-secret"
EOF
unset BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_CLI_MODE
unset BACKUP_S3_CLI BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
export ENV_FILE="$TEMP_DIR/backup.env"
test "$("$ROOT_DIR/scripts/ops/object-storage.sh" size "test/mysql/backup.sql.gz")" = \
  "$(wc -c < "$TEMP_DIR/backup.sql.gz" | tr -d '[:space:]')"

printf 'invalid checksum\n' > "$TEMP_DIR/backup.sql.gz.sha256"
if BACKUP_REQUIRE_CHECKSUM=true \
  RESTORE_DATABASE=hushle_restore_checksum_test \
  RESTORE_USE_ROOT=true \
  "$ROOT_DIR/scripts/ops/mysql-restore.sh" \
  "$TEMP_DIR/backup.sql.gz" >"$TEMP_DIR/restore.log" 2>&1; then
  echo "Corrupt checksum unexpectedly passed." >&2
  exit 1
fi

if RESTORE_DATABASE=hushle "$ROOT_DIR/scripts/ops/mysql-restore.sh" \
  "$TEMP_DIR/backup.sql.gz" >"$TEMP_DIR/in-place.log" 2>&1; then
  echo "In-place restore unexpectedly passed." >&2
  exit 1
fi
grep -qi 'active database' "$TEMP_DIR/in-place.log"

cat > "$TEMP_DIR/database-url.env" <<EOF
DATABASE_URL="mysql://user:pass@mysql:3306/hushle_active?connection_limit=5"
EOF
unset MYSQL_DATABASE
if ENV_FILE="$TEMP_DIR/database-url.env" \
  RESTORE_DATABASE=hushle_active \
  "$ROOT_DIR/scripts/ops/mysql-restore.sh" \
  "$TEMP_DIR/backup.sql.gz" >"$TEMP_DIR/database-url-target.log" 2>&1; then
  echo "DATABASE_URL-derived active database restore unexpectedly passed." >&2
  exit 1
fi
grep -qi 'active database' "$TEMP_DIR/database-url-target.log"
export MYSQL_DATABASE=hushle

LOCK_ROOT="$TEMP_DIR/lock-root"
mkdir -p "$LOCK_ROOT"
SCHEMA_OPS_LOCK_DIR="$LOCK_ROOT/locks" bash -c '
  source "$1/scripts/ops/lib/schema-ops-lock.sh"
  acquire_schema_ops_lock "$2" "holder"
  sleep 2
' _ "$ROOT_DIR" "$LOCK_ROOT" &
LOCK_HOLDER_PID=$!
sleep 0.2
if SCHEMA_OPS_LOCK_DIR="$LOCK_ROOT/locks" SCHEMA_OPS_LOCK_TIMEOUT_SECONDS=0 \
  bash -c '
    source "$1/scripts/ops/lib/schema-ops-lock.sh"
    acquire_schema_ops_lock "$2" "contender"
  ' _ "$ROOT_DIR" "$LOCK_ROOT"; then
  echo "Concurrent schema operation unexpectedly acquired the lock." >&2
  exit 1
fi
wait "$LOCK_HOLDER_PID"
unset MYSQL_DATABASE
if ! grep -qi 'checksum' "$TEMP_DIR/restore.log"; then
  cat "$TEMP_DIR/restore.log" >&2
  echo "Restore did not fail at checksum validation." >&2
  exit 1
fi

grep -q 'backup-cli:' "$ROOT_DIR/docker-compose.ops.yml"
grep -Eq 'public\.ecr\.aws/aws-cli/aws-cli:[0-9]+\.[0-9]+\.[0-9]+' \
  "$ROOT_DIR/docker-compose.ops.yml"
if grep -Eq '^[[:space:]]+(app|jobs):' "$ROOT_DIR/docker-compose.ops.yml"; then
  echo "Ops compose must not redefine application services." >&2
  exit 1
fi

echo "Offsite backup checks passed."
