#!/usr/bin/env bash
# End-to-end proof of the offsite data backup against a real S3-compatible
# server (MinIO) and a real MySQL server. The production scripts run unchanged,
# the same way an operator or cron runs them:
#   data-backup.sh -> mysql-backup.sh + data-backup.mjs -> object-storage.sh
#   (Docker CLI mode, docker-compose.ops.yml) -> data-restore.sh -> mysql-restore.sh
# plus the DB-only mysql-backup.sh retention, remote mysql-restore.sh and the
# weekly restore smoke.
#
# Topology: a throwaway Compose project holds MinIO and a `mysql` service that
# is a MySQL *client* container whose option file points at the external
# server, so `docker compose exec mysql mysqldump ...` behaves like the
# production container while the data lives in throwaway databases.
# The ops `backup-cli` container joins the same project network and reaches
# MinIO at http://minio:9000.
#
# Requirements: Linux Bash, Docker with Compose v2, flock, GNU coreutils/tar.
# Only `tabu_backup_*` databases, the `tabu_backup_e2e` user and a temporary
# `hushle_restore_smoke_*` database are created on the MySQL server; all are
# dropped at the end. Other containers and databases are never touched.
set -euo pipefail

if [[ "${REMOTE_BACKUP_E2E:-false}" != "true" && "${1:-}" != "--run" ]]; then
  echo "Skipped. Set REMOTE_BACKUP_E2E=true or pass --run."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${E2E_MYSQL_ADMIN_PASSWORD:?Set E2E_MYSQL_ADMIN_PASSWORD to the root password of the test MySQL server}"
export E2E_MYSQL_ADMIN_PASSWORD
export E2E_MYSQL_SERVER_HOST="${E2E_MYSQL_HOST:-host.docker.internal}"
export E2E_MYSQL_SERVER_PORT="${E2E_MYSQL_PORT:-3306}"
# The upstream minio/minio image is no longer published; this is a maintained
# community build of the same server, pinned by digest.
export E2E_MINIO_IMAGE_REF="${E2E_MINIO_IMAGE:-pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372}"
export E2E_MYSQL_CLIENT_IMAGE_REF="${E2E_MYSQL_CLIENT_IMAGE:-mysql:8.4}"
NODE_IMAGE="node:20-alpine"
AWS_CLI_IMAGE="$(sed -n 's/.*BACKUP_AWS_CLI_IMAGE:-\([^}]*\)}.*/\1/p' "$REPO_ROOT/docker-compose.ops.yml")"
[[ -n "$AWS_CLI_IMAGE" ]] || { echo "Could not read the pinned AWS CLI image from docker-compose.ops.yml" >&2; exit 1; }

export E2E_SRC_DB="${E2E_SOURCE_DATABASE:-tabu_backup_src}"
RESTORE_DB="${E2E_RESTORE_DATABASE:-tabu_backup_restore}"
export E2E_DB_USER="tabu_backup_e2e"
for name in "$E2E_SRC_DB" "$RESTORE_DB"; do
  # These databases are dropped and recreated; never accept a real-looking name.
  [[ "$name" =~ ^tabu_backup_[a-z0-9_]+$ ]] || { echo "Throwaway database names must match tabu_backup_*: $name" >&2; exit 1; }
done
[[ "$E2E_SRC_DB" != "$RESTORE_DB" ]] || { echo "Source and restore databases must differ" >&2; exit 1; }

for tool in docker flock tar gzip sha256sum realpath od; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
docker compose version >/dev/null

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$(random_hex 3)"
export COMPOSE_PROJECT_NAME="hushle-backup-e2e-$RUN_ID"
WORK="$(mktemp -d "${E2E_WORK_PARENT:-${TMPDIR:-/tmp}}/hushle-backup-e2e.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
APP="$WORK/app"
LOGS="$WORK/logs"
ASSETS="$WORK/assets"
ADMIN_DIR="$WORK/admin"
mkdir -p "$APP/scripts" "$LOGS" "$ASSETS" "$ADMIN_DIR"
# A copy keeps the run away from any real backups/ directory in the checkout.
cp -R "$REPO_ROOT/scripts/ops" "$APP/scripts/"
cp "$REPO_ROOT/docker-compose.ops.yml" "$APP/"

E2E_MINIO_ROOT_USER="e2e-admin-$(random_hex 4)"
E2E_MINIO_ROOT_PASSWORD="$(random_hex 20)"
E2E_DB_USER_PASSWORD="$(random_hex 16)"
export E2E_MINIO_ROOT_USER E2E_MINIO_ROOT_PASSWORD E2E_DB_USER_PASSWORD
WRITER_KEY="hushle-backup-writer"
WRITER_SECRET="$(random_hex 20)"
PARTIAL_KEY="hushle-backup-no-checksum"
PARTIAL_SECRET="$(random_hex 20)"
WRONG_SECRET="wrong-$(random_hex 16)"
BUCKET="hushle-e2e-backups"
PREFIX="production"
COMPOSE_E2E="$WORK/e2e-compose.yml"
export E2E_CLIENT_CNF="$WORK/client.cnf"
PASSED=0

log() { printf '\n[remote-backup-e2e] %s\n' "$*"; }
pass() { PASSED=$((PASSED + 1)); printf '  ok %d - %s\n' "$PASSED" "$*"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}
e2e_compose() { docker compose -f "$COMPOSE_E2E" "$@"; }

cleanup() {
  local status=$?
  set +e
  if [[ "${E2E_KEEP:-false}" == "true" ]]; then
    echo "E2E_KEEP=true: leaving project $COMPOSE_PROJECT_NAME and $WORK for inspection" >&2
    exit "$status"
  fi
  if [[ -n "$(e2e_compose ps -q mysql 2>/dev/null)" ]]; then
    admin_sql >/dev/null 2>&1 <<SQL
DROP DATABASE IF EXISTS \`$E2E_SRC_DB\`;
DROP DATABASE IF EXISTS \`$RESTORE_DB\`;
DROP USER IF EXISTS '$E2E_DB_USER'@'%';
SQL
  fi
  docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" | xargs -r docker rm -f >/dev/null 2>&1
  e2e_compose down -v --remove-orphans >/dev/null 2>&1
  # Containers wrote some files as root; remove the work tree from a container.
  docker run --rm --network none -v "$(dirname "$WORK"):/parent" "$NODE_IMAGE" \
    rm -rf "/parent/$(basename "$WORK")" >/dev/null 2>&1 || rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

cat > "$COMPOSE_E2E" <<'YAML'
services:
  minio:
    image: ${E2E_MINIO_IMAGE_REF}
    command: ["server", "/data", "--address", ":9000"]
    environment:
      MINIO_ROOT_USER: ${E2E_MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${E2E_MINIO_ROOT_PASSWORD}
      MINIO_BROWSER: "off"
    ports:
      - "127.0.0.1::9000"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:9000/minio/health/live"]
      interval: 2s
      timeout: 5s
      retries: 60
  mysql:
    image: ${E2E_MYSQL_CLIENT_IMAGE_REF}
    entrypoint: ["sleep", "infinity"]
    init: true
    environment:
      MYSQL_DATABASE: ${E2E_SRC_DB}
      MYSQL_USER: ${E2E_DB_USER}
      MYSQL_PASSWORD: ${E2E_DB_USER_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${E2E_MYSQL_ADMIN_PASSWORD}
    volumes:
      - ${E2E_CLIENT_CNF}:/etc/mysql/conf.d/e2e-client.cnf:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
volumes:
  minio-data:
YAML
# Every client in the container (mysql, mysqldump) reads [client] from here.
printf '[client]\nhost=%s\nport=%s\nprotocol=TCP\n' "$E2E_MYSQL_SERVER_HOST" "$E2E_MYSQL_SERVER_PORT" > "$E2E_CLIENT_CNF"
chmod 0644 "$E2E_CLIENT_CNF"

admin_sql() {
  e2e_compose exec -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 -N -B "$@"' sh "$@"
}
mc_admin() { e2e_compose exec -T minio mc "$@"; }
aws_admin() {
  docker run --rm -i --network "${COMPOSE_PROJECT_NAME}_default" --user "$(id -u):$(id -g)" \
    -e AWS_ACCESS_KEY_ID="$E2E_MINIO_ROOT_USER" -e AWS_SECRET_ACCESS_KEY="$E2E_MINIO_ROOT_PASSWORD" \
    -e AWS_DEFAULT_REGION=us-east-1 -e AWS_EC2_METADATA_DISABLED=true -e HOME=/tmp \
    -v "$ADMIN_DIR:/admin" "$AWS_CLI_IMAGE" --no-cli-pager --endpoint-url http://minio:9000 "$@"
}
# Production entry point: the scripts read ENV_FILE and COMPOSE_FILE exactly as on the server.
run_prod() { (cd "$APP" && ENV_FILE="$APP/.env.production" COMPOSE_FILE="$COMPOSE_E2E" "$@"); }
remote_keys() { aws_admin s3api list-objects-v2 --bucket "$BUCKET" --prefix "$1" --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -v '^None$' | sort || true; }
table_count() { admin_sql -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$1'"; }
tree_hashes() { (cd "$1" && find . -type f ! -name '*.partial' -print0 | sort -z | xargs -0 -r sha256sum); }

# Prints per-table row counts, CHECKSUM TABLE values and DDL for one database.
db_fingerprint() {
  local db="$1" tables sql="" table
  mapfile -t tables < <(admin_sql -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$db' AND table_type = 'BASE TABLE' ORDER BY table_name")
  ((${#tables[@]} > 0)) || fail "no tables in $db"
  for table in "${tables[@]}"; do sql+="SELECT 'rows', '$table', COUNT(*) FROM \`$table\`; "; done
  sql+="CHECKSUM TABLE $(printf '`%s`,' "${tables[@]}" | sed 's/,$//') EXTENDED; "
  for table in "${tables[@]}"; do sql+="SHOW CREATE TABLE \`$table\`; "; done
  # A restored column carries an explicit COLLATE, which SHOW CREATE TABLE then
  # prints with a redundant CHARACTER SET; the column definition is the same.
  admin_sql "$db" -e "$sql" | sed -E "s/^$db\\.//; s/ CHARACTER SET [a-z0-9_]+ COLLATE / COLLATE /g"
}
assert_db_matches_source() {
  local label="$1" expected actual
  expected="$(db_fingerprint "$E2E_SRC_DB")"
  actual="$(db_fingerprint "$RESTORE_DB")"
  if [[ "$expected" != "$actual" ]]; then
    { diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | grep '^[-+][^-+]' | cut -c1-400 | head -20 >&2; } || true
    fail "$label: restored database differs from the source"
  fi
  pass "$label: $(grep -c '^rows' <<<"$expected") tables match (row counts, CHECKSUM TABLE, DDL)"
}
assert_restore_target_untouched() {
  local label="$1" assets_target="$2"
  [[ "$(table_count "$RESTORE_DB")" == "0" ]] || fail "$label: restore database was modified"
  [[ ! -e "$assets_target" ]] || fail "$label: assets target was created"
}
# Runs a command that must fail and must explain why.
expect_failure() {
  local label="$1" pattern="$2" output="$LOGS/expect-$PASSED.log"
  shift 2
  if "$@" >"$output" 2>&1; then
    cat "$output" >&2
    fail "$label: unexpectedly succeeded"
  fi
  if ! grep -Eqi -- "$pattern" "$output"; then
    cat "$output" >&2
    fail "$label: error did not match /$pattern/"
  fi
  pass "$label"
}
snapshot_name_from() { sed -n 's#^Verified data snapshot: .*/\(hushle-data-[^/]*\)$#\1#p' "$1" | tail -n 1; }
run_backup() {
  local label="$1" output="$LOGS/$2.log"
  shift 2
  if ! run_prod env "$@" bash "$APP/scripts/ops/data-backup.sh" >"$output" 2>&1; then
    cat "$output" >&2
    fail "$label: data-backup.sh failed"
  fi
  snapshot_name_from "$output"
}
restore_data() {
  run_prod env RESTORE_DATABASE="$RESTORE_DB" RESTORE_USE_ROOT=true \
    RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET "$@"
}

log "Starting MinIO and the MySQL client service (project $COMPOSE_PROJECT_NAME)"
e2e_compose up -d --wait --wait-timeout 180 >"$LOGS/compose-up.log" 2>&1 || { cat "$LOGS/compose-up.log" >&2; fail "compose up"; }
for attempt in $(seq 1 60); do
  admin_sql -e 'SELECT 1' >/dev/null 2>&1 && break
  [[ "$attempt" -lt 60 ]] || fail "MySQL server $E2E_MYSQL_SERVER_HOST:$E2E_MYSQL_SERVER_PORT is not reachable"
  sleep 2
done
pass "MinIO healthy, MySQL server reachable from the compose network"

log "Creating throwaway databases and seeding representative data"
admin_sql <<SQL
DROP DATABASE IF EXISTS \`$E2E_SRC_DB\`;
DROP DATABASE IF EXISTS \`$RESTORE_DB\`;
DROP USER IF EXISTS '$E2E_DB_USER'@'%';
CREATE DATABASE \`$E2E_SRC_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '$E2E_DB_USER'@'%' IDENTIFIED BY '$E2E_DB_USER_PASSWORD';
-- Same grant the official MySQL image gives the production app user.
GRANT ALL PRIVILEGES ON \`$E2E_SRC_DB\`.* TO '$E2E_DB_USER'@'%';
SQL
find "$REPO_ROOT/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql | sort | xargs cat | admin_sql "$E2E_SRC_DB"
admin_sql "$E2E_SRC_DB" <<'SQL'
SET SESSION cte_max_recursion_depth = 5000;
INSERT INTO users (username, email, normalized_email, password, last_seen_at, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1500)
SELECT CONCAT('oyuncu_', n, '_çğış'), CONCAT('Oyuncu', n, '@Örnek.test'), CONCAT('oyuncu', n, '@örnek.test'),
       CONCAT('$2b$12$', SHA2(n, 256)), IF(n % 3 = 0, NULL, TIMESTAMP('2026-01-01 00:00:00.123') + INTERVAL n MINUTE),
       TIMESTAMP('2025-06-01 08:00:00.456') + INTERVAL n HOUR
FROM seq;
INSERT INTO words (word_text, difficulty)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 800)
SELECT CONCAT('kelime-', n, '-İıŞşĞğÜüÖöÇç-🎲'), n % 3 + 1 FROM seq;
INSERT INTO taboo_words (word_id, taboo_word_text) SELECT id, CONCAT(word_text, '-yasak') FROM words;
CREATE TABLE e2e_fixture (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(191) NOT NULL,
  amount DECIMAL(20, 6) NULL,
  payload JSON NULL,
  raw LONGBLOB NULL,
  happened_at DATETIME(6) NOT NULL,
  note TEXT NULL,
  PRIMARY KEY (id),
  KEY e2e_fixture_label_idx (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO e2e_fixture (label, amount, payload, raw, happened_at, note) VALUES
  ('tırnak '' " \\ ters', -12345.678901, JSON_OBJECT('ad', 'Şükrü', 'emoji', '🎲🃏', 'liste', JSON_ARRAY(1, 2.5, NULL, TRUE)),
   NULL, '2026-10-15 12:34:56.789012', 'satır1\nsatır2\ttab'),
  ('all-bytes', 0, NULL,
   (SELECT UNHEX(GROUP_CONCAT(LPAD(HEX(n), 2, '0') ORDER BY n SEPARATOR ''))
      FROM (WITH RECURSIVE b(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM b WHERE n < 255) SELECT n FROM b) AS bytes),
   '1970-01-01 00:00:01.000000', NULL),
  ('large-blob', NULL, NULL, REPEAT(UNHEX('00FF27225C0A0D1A'), 524288), '2038-01-19 03:14:08.000001', REPEAT('ğ', 20000));
SQL
[[ "$(admin_sql "$E2E_SRC_DB" -e 'SELECT COUNT(*) FROM users')" == "1500" ]] || fail "seed users"
[[ "$(admin_sql "$E2E_SRC_DB" -e 'SELECT LENGTH(raw) FROM e2e_fixture WHERE label = "all-bytes"')" == "256" ]] || fail "seed bytes"
pass "source database seeded: $(table_count "$E2E_SRC_DB") tables from the real migrations plus fixtures"

# Asset tree like the persistent upload directory. The large file pushes the
# archive over the AWS CLI multipart threshold (8 MiB).
mkdir -p "$ASSETS/cosmetics/card_front" "$ASSETS/cosmetics/avatar_frame" "$ASSETS/branding"
for index in 1 2 3; do head -c $((1024 * index + 7)) /dev/urandom > "$ASSETS/cosmetics/card_front/front-$index-$(random_hex 4).png"; done
head -c 2048 /dev/urandom > "$ASSETS/branding/logo-$(random_hex 4).webp"
head -c $((24 * 1024 * 1024)) /dev/urandom > "$ASSETS/cosmetics/avatar_frame/large-frame.png"
printf 'unfinished upload' > "$ASSETS/cosmetics/card_front/front-9.png.$(random_hex 4).partial"
SOURCE_ASSET_HASHES="$(tree_hashes "$ASSETS")"
pass "asset tree prepared: $(wc -l <<<"$SOURCE_ASSET_HASHES") files plus one in-flight .partial"

log "Configuring the bucket, a least-privilege writer and the lifecycle policy"
mc_admin alias set local http://127.0.0.1:9000 "$E2E_MINIO_ROOT_USER" "$E2E_MINIO_ROOT_PASSWORD" >/dev/null
mc_admin mb "local/$BUCKET" >/dev/null
# The writer can put, read and list under the prefix but never delete (docs/deploy/mysql-backups.md).
e2e_compose exec -T minio sh -c 'cat > /tmp/writer.json' <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET"],"Condition":{"StringLike":{"s3:prefix":["$PREFIX/*"]}}},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::$BUCKET/$PREFIX/*"]}]}
JSON
# Same as the writer, but checksum sidecars are denied: produces an archive
# without its .sha256, i.e. an upload interrupted between the two objects.
e2e_compose exec -T minio sh -c 'cat > /tmp/no-checksum.json' <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET"],"Condition":{"StringLike":{"s3:prefix":["$PREFIX/*"]}}},
 {"Effect":"Allow","Action":["s3:GetObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::$BUCKET/$PREFIX/*"]},
 {"Effect":"Allow","Action":["s3:PutObject"],"Resource":["arn:aws:s3:::$BUCKET/$PREFIX/data/*.tar.gz"]}]}
JSON
mc_admin admin policy create local hushle-backup-writer /tmp/writer.json >/dev/null
mc_admin admin policy create local hushle-backup-no-checksum /tmp/no-checksum.json >/dev/null
mc_admin admin user add local "$WRITER_KEY" "$WRITER_SECRET" >/dev/null
mc_admin admin user add local "$PARTIAL_KEY" "$PARTIAL_SECRET" >/dev/null
mc_admin admin policy attach local hushle-backup-writer --user "$WRITER_KEY" >/dev/null
mc_admin admin policy attach local hushle-backup-no-checksum --user "$PARTIAL_KEY" >/dev/null
# The exact rule from docs/deploy/persistent-assets-and-data-backups.md. MinIO
# accepts it but drops AbortIncompleteMultipartUpload; R2 and S3 keep it.
cat > "$ADMIN_DIR/lifecycle.json" <<JSON
{"Rules":[{"ID":"hushle-backup-retention","Status":"Enabled","Filter":{"Prefix":"$PREFIX/"},"Expiration":{"Days":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
JSON
aws_admin s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///admin/lifecycle.json
LIFECYCLE="$(aws_admin s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --query 'Rules[0].[ID,Status,Filter.Prefix,Expiration.Days]' --output text)"
[[ "$LIFECYCLE" == "hushle-backup-retention"$'\t'"Enabled"$'\t'"$PREFIX/"$'\t'"30" ]] || fail "lifecycle rule not stored: $LIFECYCLE"
pass "bucket lifecycle expires $PREFIX/ after 30 days (provider-side retention)"

cat > "$APP/.env.production" <<ENV
MYSQL_DATABASE=$E2E_SRC_DB
MYSQL_USER=$E2E_DB_USER
ASSET_STORAGE_HOST_PATH=$ASSETS
BACKUP_REMOTE_ENABLED=true
BACKUP_S3_ENDPOINT=http://minio:9000
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=$BUCKET
BACKUP_S3_PREFIX=$PREFIX
BACKUP_S3_ACCESS_KEY_ID=$WRITER_KEY
BACKUP_S3_SECRET_ACCESS_KEY=$WRITER_SECRET
BACKUP_S3_CLI_MODE=docker
BACKUP_REMOTE_RETENTION_DAYS=30
ENV

log "1. Backup: DB dump + assets snapshot uploaded with the least-privilege writer"
SNAPSHOT_A="$(run_backup "first backup" backup-a)"
[[ -n "$SNAPSHOT_A" && -d "$APP/backups/data/$SNAPSHOT_A" ]] || fail "first backup did not report a snapshot"
mapfile -t KEYS < <(remote_keys "$PREFIX/")
[[ "${KEYS[*]}" == "$PREFIX/data/$SNAPSHOT_A.tar.gz $PREFIX/data/$SNAPSHOT_A.tar.gz.sha256" ]] || fail "unexpected remote objects: ${KEYS[*]}"
pass "remote holds exactly the archive and its checksum sidecar"
[[ -z "$(find "$APP/backups/staging" -type f)" ]] || fail "staging dump left behind: $(ls "$APP/backups/staging")"
[[ ! -e "$APP/backups/data/$SNAPSHOT_A.tar.gz" ]] || fail "local upload archive left behind"
pass "staging dump and local upload archive cleaned up; snapshot directory kept"
[[ "$(stat -c %u "$APP/backups/data/$SNAPSHOT_A")" == "$(id -u)" ]] || fail "snapshot not owned by the operator account"
pass "snapshot directory owned by the operator account ($(id -u))"

log "2. List remote snapshots"
run_prod bash "$APP/scripts/ops/data-restore.sh" list >"$LOGS/list-a.log" 2>&1 || { cat "$LOGS/list-a.log" >&2; fail "list"; }
grep -Eq "^complete[[:space:]]+${SNAPSHOT_A}[[:space:]]" "$LOGS/list-a.log" || { cat "$LOGS/list-a.log" >&2; fail "list does not show the complete snapshot"; }
run_prod bash "$APP/scripts/ops/object-storage.sh" list "$PREFIX/data/" >"$LOGS/raw-list.log"
[[ "$(wc -l < "$LOGS/raw-list.log")" == "2" ]] || fail "object-storage.sh list: $(cat "$LOGS/raw-list.log")"
pass "data-restore.sh list marks $SNAPSHOT_A complete; object-storage.sh list returns both objects"

expect_failure "writer key cannot delete backups" "AccessDenied" \
  run_prod docker compose --env-file "$APP/.env.production" -f "$APP/docker-compose.ops.yml" --profile ops \
  run --rm -T --no-deps backup-cli --endpoint-url http://minio:9000 s3api delete-object --bucket "$BUCKET" --key "$PREFIX/data/$SNAPSHOT_A.tar.gz"
[[ "$(remote_keys "$PREFIX/data/$SNAPSHOT_A.tar.gz" | head -n 1)" == "$PREFIX/data/$SNAPSHOT_A.tar.gz" ]] || fail "archive vanished"

log "3. Download and verify by hand (operator procedure)"
mkdir -p "$APP/backups/manual"
run_prod bash "$APP/scripts/ops/object-storage.sh" download "$PREFIX/data/$SNAPSHOT_A.tar.gz" "$APP/backups/manual/$SNAPSHOT_A.tar.gz"
run_prod bash "$APP/scripts/ops/object-storage.sh" download "$PREFIX/data/$SNAPSHOT_A.tar.gz.sha256" "$APP/backups/manual/$SNAPSHOT_A.tar.gz.sha256"
(cd "$APP/backups/manual" && sha256sum -c "$SNAPSHOT_A.tar.gz.sha256" >/dev/null) || fail "downloaded archive checksum"
mkdir "$WORK/manual-extract"
tar -xzf "$APP/backups/manual/$SNAPSHOT_A.tar.gz" -C "$WORK/manual-extract"
docker run --rm --network none --user "$(id -u):$(id -g)" -v "$APP/scripts/ops/data-backup.mjs:/tool/data-backup.mjs:ro" \
  -v "$WORK/manual-extract/$SNAPSHOT_A:/snapshot:ro" "$NODE_IMAGE" node /tool/data-backup.mjs verify --backup /snapshot >"$LOGS/manual-verify.log"
grep -q '^Verified ' "$LOGS/manual-verify.log" || fail "manual manifest verify"
pass "downloaded archive: sha256sum -c and manifest verify pass ($(cat "$LOGS/manual-verify.log"))"

log "4. Refusals before any data is written"
TARGET_X="$WORK/restore-refused"
cp "$APP/backups/manual/$SNAPSHOT_A.tar.gz" "$APP/backups/manual/corrupt.tar.gz"
printf '\x00\x01' | dd of="$APP/backups/manual/corrupt.tar.gz" bs=1 seek=$((5 * 1024 * 1024)) conv=notrunc status=none
mkdir -p "$APP/backups/corrupt"
mv "$APP/backups/manual/corrupt.tar.gz" "$APP/backups/corrupt/$SNAPSHOT_A.tar.gz"
cp "$APP/backups/manual/$SNAPSHOT_A.tar.gz.sha256" "$APP/backups/corrupt/"
expect_failure "corrupted downloaded archive is refused" "checksum mismatch" \
  restore_data RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$APP/backups/corrupt/$SNAPSHOT_A.tar.gz"
assert_restore_target_untouched "corrupted archive" "$TARGET_X"

# Same corruption stored in the bucket (bit rot or a bad re-upload): the
# download is checked against the sidecar before anything is extracted.
CORRUPT_NAME="${SNAPSHOT_A%-*}-0badc0de"
cp "$APP/backups/corrupt/$SNAPSHOT_A.tar.gz" "$ADMIN_DIR/corrupt.tar.gz"
sed "s/$SNAPSHOT_A/$CORRUPT_NAME/" "$APP/backups/manual/$SNAPSHOT_A.tar.gz.sha256" > "$ADMIN_DIR/corrupt.tar.gz.sha256"
aws_admin s3 cp /admin/corrupt.tar.gz "s3://$BUCKET/$PREFIX/data/$CORRUPT_NAME.tar.gz" --only-show-errors
aws_admin s3 cp /admin/corrupt.tar.gz.sha256 "s3://$BUCKET/$PREFIX/data/$CORRUPT_NAME.tar.gz.sha256" --only-show-errors
expect_failure "corrupted remote archive is refused after download" "checksum mismatch" \
  restore_data RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$CORRUPT_NAME"
assert_restore_target_untouched "corrupted remote archive" "$TARGET_X"
[[ -z "$(find "$APP/backups/restore" -mindepth 1 -maxdepth 1 2>/dev/null)" ]] || fail "restore work directory left behind"

# Inner tampering with a recomputed outer checksum is caught by the manifest.
TAMPER_NAME="${SNAPSHOT_A%-*}-7a3e9e7d"
mkdir "$WORK/tamper"
cp -R "$WORK/manual-extract/$SNAPSHOT_A" "$WORK/tamper/$TAMPER_NAME"
printf 'tampered' >> "$(find "$WORK/tamper/$TAMPER_NAME/assets/branding" -type f | head -n 1)"
tar -C "$WORK/tamper" -czf "$APP/backups/corrupt/$TAMPER_NAME.tar.gz" "$TAMPER_NAME"
(cd "$APP/backups/corrupt" && sha256sum "$TAMPER_NAME.tar.gz" > "$TAMPER_NAME.tar.gz.sha256")
expect_failure "tampered snapshot content is refused by the manifest" "corruption" \
  restore_data RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$APP/backups/corrupt/$TAMPER_NAME.tar.gz"
assert_restore_target_untouched "tampered snapshot" "$TARGET_X"

expect_failure "restore over the active database is refused" "active database" \
  run_prod env RESTORE_DATABASE="$E2E_SRC_DB" RESTORE_USE_ROOT=true RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET \
  RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A"
expect_failure "non-standard restore target needs explicit confirmation" "RESTORE_TARGET_CONFIRM" \
  run_prod env RESTORE_DATABASE="$RESTORE_DB" RESTORE_USE_ROOT=true \
  RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A"
mkdir "$WORK/existing-empty"
expect_failure "existing (even empty) assets target is refused" "already exists" \
  restore_data RESTORE_ASSETS_TARGET="$WORK/existing-empty" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A"
assert_restore_target_untouched "refused targets" "$TARGET_X"

log "5. Restore the remote snapshot into a new database and an empty assets directory"
restore_data RESTORE_ASSETS_TARGET="$WORK/restore-a" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A" \
  >"$LOGS/restore-a.log" 2>&1 || { cat "$LOGS/restore-a.log" >&2; fail "restore of $SNAPSHOT_A"; }
assert_db_matches_source "remote restore"
[[ "$(tree_hashes "$WORK/restore-a/assets")" == "$SOURCE_ASSET_HASHES" ]] || fail "restored assets differ"
pass "restored assets: every file hash matches, the in-flight .partial was not captured"
[[ -z "$(find "$APP/backups/restore" -mindepth 1 -maxdepth 1 2>/dev/null)" ]] || fail "restore work directory left behind"

expect_failure "restore over a non-empty database without confirmation is refused" "not empty" \
  restore_data RESTORE_ASSETS_TARGET="$WORK/restore-b" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A"
assert_db_matches_source "non-empty target left as it was"

log "6. Offsite failures leave a usable local snapshot and no complete remote snapshot"
REMOTE_BEFORE="$(remote_keys "$PREFIX/")"
expect_failure "wrong secret key fails the backup" "SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied" \
  run_prod env BACKUP_S3_SECRET_ACCESS_KEY="$WRONG_SECRET" bash "$APP/scripts/ops/data-backup.sh"
WRONG_LOG="$LOGS/expect-$((PASSED - 1)).log"
if grep -Fq -e "$WRONG_SECRET" -e "$WRITER_SECRET" "$WRONG_LOG"; then fail "secret printed in the backup log"; fi
WRONG_NAME="$(snapshot_name_from "$WRONG_LOG")"
[[ -n "$WRONG_NAME" && -f "$APP/backups/data/$WRONG_NAME/manifest.json" ]] || fail "local snapshot missing after offsite failure"
[[ "$(remote_keys "$PREFIX/")" == "$REMOTE_BEFORE" ]] || fail "wrong credentials changed the bucket"
pass "wrong credentials: local snapshot $WRONG_NAME kept, bucket unchanged, secret not logged"
# A bucket-scoped key gets AccessDenied for any other bucket; an account-wide
# key (the MinIO root here) sees the bucket is really missing.
expect_failure "missing bucket fails the backup (bucket-scoped key)" "AccessDenied" \
  run_prod env BACKUP_S3_BUCKET=hushle-e2e-missing-bucket bash "$APP/scripts/ops/data-backup.sh"
expect_failure "missing bucket fails the backup (account-wide key)" "NoSuchBucket" \
  run_prod env BACKUP_S3_BUCKET=hushle-e2e-missing-bucket BACKUP_S3_ACCESS_KEY_ID="$E2E_MINIO_ROOT_USER" \
  BACKUP_S3_SECRET_ACCESS_KEY="$E2E_MINIO_ROOT_PASSWORD" bash "$APP/scripts/ops/data-backup.sh"
[[ "$(remote_keys "$PREFIX/")" == "$REMOTE_BEFORE" ]] || fail "missing bucket changed the bucket"

expect_failure "checksum upload failure fails the backup" "AccessDenied" \
  run_prod env BACKUP_S3_ACCESS_KEY_ID="$PARTIAL_KEY" BACKUP_S3_SECRET_ACCESS_KEY="$PARTIAL_SECRET" bash "$APP/scripts/ops/data-backup.sh"
PARTIAL_NAME="$(snapshot_name_from "$LOGS/expect-$((PASSED - 1)).log")"
[[ -n "$(remote_keys "$PREFIX/data/$PARTIAL_NAME.tar.gz")" ]] || fail "partial archive was not uploaded"
[[ -z "$(remote_keys "$PREFIX/data/$PARTIAL_NAME.tar.gz.sha256")" ]] || fail "partial snapshot has a sidecar"
run_prod bash "$APP/scripts/ops/data-restore.sh" list >"$LOGS/list-partial.log"
grep -Eq "^incomplete[[:space:]]+${PARTIAL_NAME}[[:space:]]" "$LOGS/list-partial.log" || { cat "$LOGS/list-partial.log" >&2; fail "partial snapshot not listed as incomplete"; }
pass "archive without checksum is listed as incomplete"
admin_sql -e "DROP DATABASE \`$RESTORE_DB\`; CREATE DATABASE \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
expect_failure "incomplete snapshot (no checksum) is refused" "incomplete|checksum sidecar" \
  restore_data RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$PARTIAL_NAME"
assert_restore_target_untouched "incomplete snapshot" "$TARGET_X"

# Interrupted transfer: MinIO is slowed down so the multipart upload is
# observably in flight (the uploader has sent part data), then the uploader is
# killed mid-transfer.
MINIO_CONTAINER="$(e2e_compose ps -q minio)"
head -c $((96 * 1024 * 1024)) /dev/urandom > "$ASSETS/cosmetics/avatar_frame/interrupt-frame.png"
docker update --cpus 0.02 "$MINIO_CONTAINER" >/dev/null
run_prod bash "$APP/scripts/ops/data-backup.sh" >"$LOGS/interrupted.log" 2>&1 &
BACKUP_PID=$!
# Megabytes sent by a container, from `docker stats` NetIO ("rx / tx").
sent_megabytes() {
  docker stats --no-stream --format '{{.NetIO}}' "$1" 2>/dev/null | awk -F' / ' '{
    n = $2 + 0
    if ($2 ~ /GB$/) n *= 1000; else if ($2 ~ /kB$/) n /= 1000; else if ($2 !~ /MB$/) n = 0
    print int(n)
  }'
}
UPLOADER=""
SENT=0
for _ in $(seq 1 900); do
  kill -0 "$BACKUP_PID" 2>/dev/null || break
  UPLOADER="$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=backup-cli" | head -n 1)"
  if [[ -n "$UPLOADER" ]]; then
    SENT="$(sent_megabytes "$UPLOADER")"
    (( ${SENT:-0} >= 4 )) && break
  fi
  sleep 0.2
done
if [[ -z "$UPLOADER" ]] || (( ${SENT:-0} < 4 )); then
  cat "$LOGS/interrupted.log" >&2
  fail "the archive upload was never observed in flight"
fi
docker kill "$UPLOADER" >/dev/null 2>&1 || true
docker update --cpus "$(docker info --format "{{.NCPU}}")" "$MINIO_CONTAINER" >/dev/null
if wait "$BACKUP_PID"; then cat "$LOGS/interrupted.log" >&2; fail "interrupted backup reported success"; fi
INTERRUPTED_NAME="$(snapshot_name_from "$LOGS/interrupted.log")"
[[ -n "$INTERRUPTED_NAME" ]] || fail "interrupted backup did not finish its local snapshot"
[[ -z "$(remote_keys "$PREFIX/data/$INTERRUPTED_NAME.tar.gz")" ]] || fail "interrupted upload left a visible archive object"
[[ -z "$(remote_keys "$PREFIX/data/$INTERRUPTED_NAME.tar.gz.sha256")" ]] || fail "interrupted upload produced a checksum sidecar"
MULTIPART_LEFT="$(aws_admin s3api list-multipart-uploads --bucket "$BUCKET" --prefix "$PREFIX/data/$INTERRUPTED_NAME.tar.gz" --query 'length(Uploads || `[]`)' --output text)"
[[ "$MULTIPART_LEFT" =~ ^[1-9][0-9]*$ ]] || fail "no unfinished multipart upload after the interruption ($MULTIPART_LEFT)"
pass "interrupted after ${SENT} MB sent: script failed, no archive object, no checksum sidecar, $MULTIPART_LEFT unfinished multipart upload(s) left for the lifecycle rule"
expect_failure "interrupted snapshot is refused" "incomplete|checksum sidecar" \
  restore_data RESTORE_ASSETS_TARGET="$TARGET_X" bash "$APP/scripts/ops/data-restore.sh" restore "$INTERRUPTED_NAME"
assert_restore_target_untouched "interrupted snapshot" "$TARGET_X"
rm -f "$ASSETS/cosmetics/avatar_frame/interrupt-frame.png"

exec 8>"$APP/backups/.locks/data-backup.lock"
flock -n 8 || fail "could not take the backup lock for the concurrency check"
expect_failure "a second backup while one runs is refused" "Another data backup is running" \
  run_prod bash "$APP/scripts/ops/data-backup.sh"
exec 8>&-

log "7. Recovery: the next run succeeds and restores over the old copy only with confirmation"
admin_sql "$E2E_SRC_DB" -e "INSERT INTO words (word_text, difficulty) VALUES ('kurtarma-sonrası', 2);"
SNAPSHOT_B="$(run_backup "backup after failures" backup-b)"
run_prod bash "$APP/scripts/ops/data-restore.sh" list >"$LOGS/list-b.log"
grep -Eq "^complete[[:space:]]+${SNAPSHOT_B}[[:space:]]" "$LOGS/list-b.log" || fail "recovery snapshot not complete"
restore_data RESTORE_ASSETS_TARGET="$WORK/restore-a2" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_A" >"$LOGS/restore-a2.log" 2>&1 \
  || { cat "$LOGS/restore-a2.log" >&2; fail "restore into the recreated database"; }
expect_failure "restore of a newer snapshot over the restored copy needs confirmation" "RESTORE_OVERWRITE_CONFIRM" \
  restore_data RESTORE_ASSETS_TARGET="$WORK/restore-b" bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_B"
restore_data RESTORE_OVERWRITE_CONFIRM="$RESTORE_DB" RESTORE_ASSETS_TARGET="$WORK/restore-b" \
  bash "$APP/scripts/ops/data-restore.sh" restore "$SNAPSHOT_B" >"$LOGS/restore-b.log" 2>&1 \
  || { cat "$LOGS/restore-b.log" >&2; fail "confirmed restore of $SNAPSHOT_B"; }
assert_db_matches_source "confirmed restore of the recovery snapshot"
[[ "$(tree_hashes "$WORK/restore-b/assets")" == "$SOURCE_ASSET_HASHES" ]] || fail "recovery assets differ"
pass "recovery snapshot assets match"

log "8. Local snapshot restore (pre-migration backup path)"
admin_sql -e "DROP DATABASE \`$RESTORE_DB\`; CREATE DATABASE \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
restore_data RESTORE_ASSETS_TARGET="$WORK/restore-local" bash "$APP/scripts/ops/data-restore.sh" restore "$APP/backups/data/$SNAPSHOT_B" \
  >"$LOGS/restore-local.log" 2>&1 || { cat "$LOGS/restore-local.log" >&2; fail "local snapshot restore"; }
assert_db_matches_source "local snapshot restore"
[[ "$(tree_hashes "$WORK/restore-local/assets")" == "$SOURCE_ASSET_HASHES" ]] || fail "local snapshot assets differ"

log "9. DB-only backup: local retention, remote copy, remote restore and restore smoke"
MYSQL_DIR="$APP/backups/mysql"
mkdir -p "$MYSQL_DIR"
touch -d '45 days ago' "$MYSQL_DIR/hushle-mysql-20200101T000000Z.sql.gz" "$MYSQL_DIR/hushle-mysql-20200101T000000Z.sql.gz.sha256" "$MYSQL_DIR/operator-notes.txt"
touch -d '2 days ago' "$MYSQL_DIR/hushle-mysql-20990101T000000Z.sql.gz"
run_prod env RETENTION_DAYS=30 bash "$APP/scripts/ops/mysql-backup.sh" >"$LOGS/mysql-backup.log" 2>&1 || { cat "$LOGS/mysql-backup.log" >&2; fail "mysql-backup.sh"; }
DUMP="$(sed -n 's/^Backup written to //p' "$LOGS/mysql-backup.log")"
[[ -f "$DUMP" && -f "$DUMP.sha256" ]] || fail "DB-only dump missing"
[[ ! -e "$MYSQL_DIR/hushle-mysql-20200101T000000Z.sql.gz" && ! -e "$MYSQL_DIR/hushle-mysql-20200101T000000Z.sql.gz.sha256" ]] || fail "retention kept an old dump"
[[ -e "$MYSQL_DIR/hushle-mysql-20990101T000000Z.sql.gz" && -e "$MYSQL_DIR/operator-notes.txt" ]] || fail "retention deleted a recent or foreign file"
pass "RETENTION_DAYS=30 removed only the 45-day-old dump pair"
DUMP_KEY="$PREFIX/mysql/$(basename "$DUMP")"
[[ "$(remote_keys "$DUMP_KEY")" == "$DUMP_KEY"$'\n'"$DUMP_KEY.sha256" ]] || fail "DB-only dump not offsite: $(remote_keys "$PREFIX/mysql/")"
pass "DB-only dump and checksum uploaded to $PREFIX/mysql/"
run_prod env RESTORE_DATABASE="$RESTORE_DB" RESTORE_USE_ROOT=true RESTORE_TARGET_CONFIRM=I_ACCEPT_AN_ISOLATED_RESTORE_TARGET \
  RESTORE_OVERWRITE_CONFIRM="$RESTORE_DB" bash "$APP/scripts/ops/mysql-restore.sh" "s3://$BUCKET/$DUMP_KEY" >"$LOGS/mysql-restore-remote.log" 2>&1 \
  || { cat "$LOGS/mysql-restore-remote.log" >&2; fail "remote mysql-restore.sh"; }
assert_db_matches_source "remote DB-only restore"
run_prod bash "$APP/scripts/ops/mysql-restore-smoke.sh" "$DUMP" >"$LOGS/smoke.log" 2>&1 || { cat "$LOGS/smoke.log" >&2; fail "restore smoke"; }
grep -q "Restore smoke test passed with $(table_count "$E2E_SRC_DB") tables" "$LOGS/smoke.log" || { cat "$LOGS/smoke.log" >&2; fail "smoke table count"; }
[[ -z "$(admin_sql -e "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'hushle\\_restore\\_smoke\\_%'")" ]] || fail "smoke database left behind"
pass "mysql-restore-smoke.sh passed and dropped its temporary database"

log "Passed $PASSED checks"
