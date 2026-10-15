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

if [[ "$service" == "s3api" && "$command" == "list-objects-v2" ]]; then
  bucket=""
  prefix=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bucket)
        bucket="$2"
        shift 2
        ;;
      --prefix)
        prefix="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  found=false
  while IFS= read -r file; do
    key="${file#"$MOCK_S3_ROOT/$bucket/"}"
    [[ "$key" == "$prefix"* ]] || continue
    printf '%s\t%s\t2026-10-15T03:15:00+00:00\n' "$key" "$(wc -c < "$file" | tr -d '[:space:]')"
    found=true
  done < <(find "$MOCK_S3_ROOT/$bucket" -type f 2>/dev/null | sort)
  [[ "$found" == "true" ]] || echo "None"
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

# --- Restore guards, snapshot listing and the DB-only dump without Docker ---
# A fake docker CLI answers the restore-target inspection, records imports and
# fails every other call, so a guard that lets something through is visible.
FAKE_BIN="$TEMP_DIR/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  *mysqldump*)
    printf 'CREATE TABLE `fake_dump` (`id` int);\n'
    ;;
  *information_schema.schemata*)
    printf '%s\n%s\n' "${FAKE_TARGET_SCHEMAS:-1}" "${FAKE_TARGET_TABLES:-0}"
    ;;
  *"exec mysql "*)
    cat > "$FAKE_IMPORT_FILE"
    ;;
  *)
    echo "fake docker: unexpected call: $*" >&2
    exit 97
    ;;
esac
EOF
chmod +x "$FAKE_BIN/docker"
export FAKE_DOCKER_LOG="$TEMP_DIR/fake-docker.log"
export FAKE_IMPORT_FILE="$TEMP_DIR/fake-import.sql"
OPS_ENV="$TEMP_DIR/ops.env"
cat > "$OPS_ENV" <<EOF
MYSQL_DATABASE=hushle
BACKUP_S3_BUCKET=test-bucket
BACKUP_S3_PREFIX=prod
BACKUP_S3_ENDPOINT=https://example.invalid
BACKUP_S3_CLI_MODE=host
BACKUP_S3_CLI=$MOCK_CLI
BACKUP_S3_ACCESS_KEY_ID=file-access
BACKUP_S3_SECRET_ACCESS_KEY=file-secret
EOF
ops() {
  env PATH="$FAKE_BIN:$PATH" ENV_FILE="$OPS_ENV" COMPOSE_FILE="$TEMP_DIR/compose.yml" \
    BACKUP_ROOT="$TEMP_DIR/ops-backups" SCHEMA_OPS_LOCK_DIR="$TEMP_DIR/ops-locks" "$@"
}
expect_refusal() {
  local label="$1" pattern="$2" log="$TEMP_DIR/refusal.log"
  shift 2
  if "$@" >"$log" 2>&1; then
    cat "$log" >&2
    echo "$label: unexpectedly succeeded." >&2
    exit 1
  fi
  if ! grep -Eqi -- "$pattern" "$log"; then
    cat "$log" >&2
    echo "$label: error did not match /$pattern/." >&2
    exit 1
  fi
}
RESTORE_SCRIPT="$ROOT_DIR/scripts/ops/mysql-restore.sh"
DATA_RESTORE="$ROOT_DIR/scripts/ops/data-restore.sh"

# mysql-backup.sh: the checksum sits next to OUTPUT_FILE even outside BACKUP_DIR
# (data-backup.sh writes its dump to backups/staging).
ops env BACKUP_DIR="$TEMP_DIR/ops-backups/mysql" OUTPUT_FILE="$TEMP_DIR/ops-backups/staging/dump.sql.gz" \
  BACKUP_REMOTE_ENABLED=false bash "$ROOT_DIR/scripts/ops/mysql-backup.sh" >/dev/null
(cd "$TEMP_DIR/ops-backups/staging" && sha256sum --check --quiet dump.sql.gz.sha256)
[[ ! -e "$TEMP_DIR/ops-backups/mysql/dump.sql.gz.sha256" ]]

for schema in mysql SYS information_schema performance_schema; do
  expect_refusal "system schema $schema" "system schema" \
    ops env RESTORE_DATABASE="$schema" RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET bash "$RESTORE_SCRIPT" --preflight
done
expect_refusal "missing target database" "does not exist" \
  ops env RESTORE_DATABASE=hushle_restore_unit FAKE_TARGET_SCHEMAS=0 bash "$RESTORE_SCRIPT" --preflight
expect_refusal "non-empty target database" "not empty \(3 tables\)" \
  ops env RESTORE_DATABASE=hushle_restore_unit FAKE_TARGET_TABLES=3 bash "$RESTORE_SCRIPT" --preflight
expect_refusal "overwrite confirmation must name the target" "not empty" \
  ops env RESTORE_DATABASE=hushle_restore_unit FAKE_TARGET_TABLES=3 RESTORE_OVERWRITE_CONFIRM=yes bash "$RESTORE_SCRIPT" --preflight
ops env RESTORE_DATABASE=hushle_restore_unit FAKE_TARGET_TABLES=3 RESTORE_OVERWRITE_CONFIRM=hushle_restore_unit \
  bash "$RESTORE_SCRIPT" --preflight | grep -q 'passed preflight'

DUMP_FILE="$TEMP_DIR/ops-backups/staging/dump.sql.gz"
rm -f "$FAKE_IMPORT_FILE"
expect_refusal "expected hash mismatch" "Checksum verification failed" \
  ops env RESTORE_DATABASE=hushle_restore_unit BACKUP_EXPECTED_SHA256="$(printf '0%.0s' {1..64})" bash "$RESTORE_SCRIPT" "$DUMP_FILE"
[[ ! -e "$FAKE_IMPORT_FILE" ]]
expect_refusal "import into a non-empty target" "not empty" \
  ops env RESTORE_DATABASE=hushle_restore_unit FAKE_TARGET_TABLES=1 bash "$RESTORE_SCRIPT" "$DUMP_FILE"
[[ ! -e "$FAKE_IMPORT_FILE" ]]
ops env RESTORE_DATABASE=hushle_restore_unit bash "$RESTORE_SCRIPT" "$DUMP_FILE" >/dev/null
grep -q 'CREATE TABLE `fake_dump`' "$FAKE_IMPORT_FILE"

# Remote snapshot listing: only archive + sidecar pairs are complete.
SNAP_COMPLETE="hushle-data-2026-10-14T03-15-00-000Z-0123abcd"
SNAP_PARTIAL="hushle-data-2026-10-15T03-15-00-000Z-4567cdef"
SNAP_ORPHAN="hushle-data-2026-10-13T03-15-00-000Z-89abcdef"
REMOTE_DATA="$MOCK_ROOT/test-bucket/prod/data"
mkdir -p "$REMOTE_DATA"
printf 'archive' > "$REMOTE_DATA/$SNAP_COMPLETE.tar.gz"
printf 'sum' > "$REMOTE_DATA/$SNAP_COMPLETE.tar.gz.sha256"
printf 'partial' > "$REMOTE_DATA/$SNAP_PARTIAL.tar.gz"
printf 'sum' > "$REMOTE_DATA/$SNAP_ORPHAN.tar.gz.sha256"
printf 'note' > "$REMOTE_DATA/operator-note.txt"
ops bash "$DATA_RESTORE" list > "$TEMP_DIR/list.txt"
EXPECTED_LIST="$(printf 'orphan-checksum\t%s\ncomplete\t%s\nincomplete\t%s' "$SNAP_ORPHAN" "$SNAP_COMPLETE" "$SNAP_PARTIAL")"
[[ "$(cut -f1,2 "$TEMP_DIR/list.txt")" == "$EXPECTED_LIST" ]] || { cat "$TEMP_DIR/list.txt" >&2; echo "Unexpected snapshot listing." >&2; exit 1; }
[[ "$(ops bash "$ROOT_DIR/scripts/ops/object-storage.sh" list prod/data/ | wc -l)" == "5" ]]
[[ -z "$(ops bash "$ROOT_DIR/scripts/ops/object-storage.sh" list prod/nothing-here/)" ]]

# data-restore.sh refusals: nothing is downloaded or written before they pass.
RESTORE_TARGET="$TEMP_DIR/restored-assets"
data_restore() {
  ops env RESTORE_DATABASE=hushle_restore_unit RESTORE_ASSETS_TARGET="$RESTORE_TARGET" bash "$DATA_RESTORE" restore "$@"
}
expect_refusal "assets target required" "RESTORE_ASSETS_TARGET is required" \
  ops env RESTORE_DATABASE=hushle_restore_unit bash "$DATA_RESTORE" restore "$SNAP_COMPLETE"
mkdir "$TEMP_DIR/existing-assets"
expect_refusal "existing assets target" "already exists" \
  ops env RESTORE_DATABASE=hushle_restore_unit RESTORE_ASSETS_TARGET="$TEMP_DIR/existing-assets" bash "$DATA_RESTORE" restore "$SNAP_COMPLETE"
expect_refusal "active database" "active database" \
  ops env RESTORE_DATABASE=hushle RESTORE_ASSETS_TARGET="$RESTORE_TARGET" bash "$DATA_RESTORE" restore "$SNAP_COMPLETE"
expect_refusal "non-empty database before download" "not empty" \
  ops env FAKE_TARGET_TABLES=2 RESTORE_DATABASE=hushle_restore_unit RESTORE_ASSETS_TARGET="$RESTORE_TARGET" bash "$DATA_RESTORE" restore "$SNAP_COMPLETE"
expect_refusal "bad snapshot name" "Not a data snapshot name" data_restore "../$SNAP_COMPLETE"
expect_refusal "other bucket" "must match BACKUP_S3_BUCKET" data_restore "s3://other-bucket/prod/data/$SNAP_COMPLETE.tar.gz"
expect_refusal "incomplete remote snapshot" "incomplete" data_restore "$SNAP_PARTIAL"
expect_refusal "malformed remote sidecar" "Checksum sidecar is malformed" data_restore "$SNAP_COMPLETE"
printf '%064d  %s.tar.gz\n' 0 "$SNAP_COMPLETE" > "$REMOTE_DATA/$SNAP_COMPLETE.tar.gz.sha256"
expect_refusal "corrupted remote archive" "Checksum mismatch" data_restore "$SNAP_COMPLETE"
expect_refusal "corrupted remote archive by full key" "Checksum mismatch" data_restore "s3://test-bucket/prod/data/$SNAP_COMPLETE.tar.gz"

# Local archives: checksum sidecar, archive layout and entry types.
SNAP_LOCAL="hushle-data-2026-10-15T04-00-00-000Z-fedcba98"
LOCAL_DIR="$TEMP_DIR/local-archives"
mkdir -p "$LOCAL_DIR/src/$SNAP_LOCAL/assets/branding"
printf 'dump' | gzip -c > "$LOCAL_DIR/src/$SNAP_LOCAL/mysql.sql.gz"
printf 'logo' > "$LOCAL_DIR/src/$SNAP_LOCAL/assets/branding/logo.png"
printf '{}' > "$LOCAL_DIR/src/$SNAP_LOCAL/manifest.json"
make_archive() {
  local archive="$LOCAL_DIR/$SNAP_LOCAL.tar.gz"
  rm -f "$archive" "$archive.sha256"
  tar -C "$LOCAL_DIR/src" -czf "$archive" "$@"
  (cd "$LOCAL_DIR" && sha256sum "$SNAP_LOCAL.tar.gz" > "$SNAP_LOCAL.tar.gz.sha256")
  printf '%s' "$archive"
}
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
rm "$ARCHIVE.sha256"
expect_refusal "local archive without checksum" "Checksum sidecar missing" data_restore "$ARCHIVE"
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
printf 'x' >> "$ARCHIVE"
expect_refusal "corrupted local archive" "Checksum mismatch" data_restore "$ARCHIVE"
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
sed -i "s/$SNAP_LOCAL/$SNAP_COMPLETE/" "$ARCHIVE.sha256"
expect_refusal "sidecar for another archive" "describes another archive" data_restore "$ARCHIVE"
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
SIDECAR_LINE="$(cat "$ARCHIVE.sha256")"
printf '%s\n%s\n' "$SIDECAR_LINE" "$SIDECAR_LINE" > "$ARCHIVE.sha256"
expect_refusal "two-line sidecar" "malformed" data_restore "$ARCHIVE"
ARCHIVE="$(make_archive --transform "s,^$SNAP_LOCAL/manifest.json\$,$SNAP_LOCAL/../escape.json," "$SNAP_LOCAL")"
expect_refusal "path traversal entry" "escapes the snapshot directory" data_restore "$ARCHIVE"
ARCHIVE="$(make_archive --transform "s,^$SNAP_LOCAL/manifest.json\$,other/manifest.json," "$SNAP_LOCAL")"
expect_refusal "entry outside the snapshot" "outside the snapshot directory" data_restore "$ARCHIVE"
ln -s /etc/passwd "$LOCAL_DIR/src/$SNAP_LOCAL/assets/branding/link.png"
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
expect_refusal "symlink entry" "links or special files" data_restore "$ARCHIVE"
rm "$LOCAL_DIR/src/$SNAP_LOCAL/assets/branding/link.png"
# A link listed before a large member must still be refused: a reader that
# stops at the first match lets tar die of SIGPIPE and can hide the finding.
ln -s /etc/passwd "$LOCAL_DIR/src/$SNAP_LOCAL/assets/aa-link.png"
head -c $((16 * 1024 * 1024)) /dev/urandom > "$LOCAL_DIR/src/$SNAP_LOCAL/assets/large.png"
ARCHIVE="$(make_archive "$SNAP_LOCAL/assets/aa-link.png" "$SNAP_LOCAL/assets/large.png" \
  "$SNAP_LOCAL/manifest.json" "$SNAP_LOCAL/mysql.sql.gz")"
expect_refusal "link listed before a large member" "links or special files" data_restore "$ARCHIVE"
rm "$LOCAL_DIR/src/$SNAP_LOCAL/assets/aa-link.png" "$LOCAL_DIR/src/$SNAP_LOCAL/assets/large.png"
printf 'not a gzip stream' > "$LOCAL_DIR/broken.tar.gz"
(cd "$LOCAL_DIR" && sha256sum broken.tar.gz | sed "s/broken/$SNAP_LOCAL/" > "$SNAP_LOCAL.tar.gz.sha256")
mv "$LOCAL_DIR/broken.tar.gz" "$LOCAL_DIR/$SNAP_LOCAL.tar.gz"
expect_refusal "unreadable archive with a matching checksum" "cannot be listed" data_restore "$LOCAL_DIR/$SNAP_LOCAL.tar.gz"
# A well-formed archive passes every shell check and reaches the manifest
# verifier container (which the fake docker refuses).
: > "$FAKE_DOCKER_LOG"
ARCHIVE="$(make_archive "$SNAP_LOCAL")"
expect_refusal "valid archive reaches manifest verification" "fake docker: unexpected call: run .*node /tool/data-backup.mjs verify --backup /snapshot" \
  data_restore "$ARCHIVE"
[[ ! -e "$RESTORE_TARGET" ]]
[[ -z "$(find "$TEMP_DIR/ops-backups/restore" -mindepth 1 2>/dev/null)" ]] || { echo "Restore work directory left behind." >&2; exit 1; }

echo "Offsite backup checks passed."
