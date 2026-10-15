#!/usr/bin/env bash
# Lists and restores DB + asset snapshots made by data-backup.sh.
# A restore never writes over live data: the database goes through
# mysql-restore.sh (isolated target, checksum, schema-ops lock) and the assets
# go to a directory that must not exist yet.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
NODE_IMAGE="node:20-alpine"
SNAPSHOT_NAME_PATTERN='^hushle-data-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z-[0-9a-f]{8}$'

# shellcheck source=scripts/ops/lib/backup-env.sh
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  data-restore.sh list
  RESTORE_DATABASE=hushle_restore_... RESTORE_ASSETS_TARGET=/new/dir \
    data-restore.sh restore <snapshot>

<snapshot> is one of:
  hushle-data-...                        remote snapshot under BACKUP_S3_PREFIX/data/
  s3://<BACKUP_S3_BUCKET>/<key>.tar.gz   remote snapshot by full key
  /path/hushle-data-....tar.gz           downloaded archive (needs its .sha256 next to it)
  /path/backups/data/hushle-data-...     local snapshot directory

RESTORE_USE_ROOT, RESTORE_TARGET_CONFIRM and RESTORE_OVERWRITE_CONFIRM are
passed to mysql-restore.sh unchanged.
EOF
  exit 1
}

die() {
  echo "$*" >&2
  exit 1
}

remote_data_prefix() {
  local prefix
  prefix="$(read_backup_env_value BACKUP_S3_PREFIX hushle)"
  printf '%s/data/' "${prefix%/}"
}

list_snapshots() {
  local prefix listing key size modified name
  local -A archive_size=() archive_time=() has_checksum=()
  prefix="$(remote_data_prefix)"
  listing="$(bash "$ROOT_DIR/scripts/ops/object-storage.sh" list "$prefix")"
  while IFS=$'\t' read -r key size modified; do
    [[ -n "$key" ]] || continue
    name="${key#"$prefix"}"
    if [[ "$name" == *.tar.gz.sha256 ]]; then
      has_checksum["${name%.tar.gz.sha256}"]=1
    elif [[ "$name" == *.tar.gz ]]; then
      archive_size["${name%.tar.gz}"]="$size"
      archive_time["${name%.tar.gz}"]="$modified"
    fi
  done <<<"$listing"

  # The checksum sidecar is uploaded last, so an archive without it is an
  # interrupted or failed upload and must not be restored.
  for name in $(printf '%s\n' "${!archive_size[@]}" "${!has_checksum[@]}" | sort -u); do
    [[ "$name" =~ $SNAPSHOT_NAME_PATTERN ]] || continue
    if [[ -n "${archive_size[$name]:-}" && -n "${has_checksum[$name]:-}" ]]; then
      printf 'complete\t%s\t%s\t%s\n' "$name" "${archive_size[$name]}" "${archive_time[$name]}"
    elif [[ -n "${archive_size[$name]:-}" ]]; then
      printf 'incomplete\t%s\t%s\t%s\n' "$name" "${archive_size[$name]}" "${archive_time[$name]}"
    else
      printf 'orphan-checksum\t%s\t-\t-\n' "$name"
    fi
  done
}

validate_snapshot_name() {
  [[ "$1" =~ $SNAPSHOT_NAME_PATTERN ]] || die "Not a data snapshot name: $1"
}

verify_archive_checksum() {
  local archive="$1" sidecar="$2" name="$3" line expected actual
  [[ -f "$sidecar" ]] || die "Checksum sidecar missing for $name: the snapshot upload is incomplete."
  [[ "$(wc -l < "$sidecar")" == "1" ]] || die "Checksum sidecar is malformed: $sidecar"
  line="$(cat "$sidecar")"
  [[ "$line" =~ ^([0-9a-f]{64})\ \ (.+)$ ]] || die "Checksum sidecar is malformed: $sidecar"
  expected="${BASH_REMATCH[1]}"
  [[ "${BASH_REMATCH[2]}" == "$name.tar.gz" ]] || die "Checksum sidecar describes another archive: ${BASH_REMATCH[2]}"
  actual="$(sha256sum "$archive" | cut -d' ' -f1)"
  [[ "$actual" == "$expected" ]] || die "Checksum mismatch for $name.tar.gz: refusing to restore a corrupted archive."
  echo "$name.tar.gz: checksum verified"
}

# Only the snapshot directory, regular files and directories may be extracted.
validate_archive_entries() {
  local archive="$1" name="$2" names details entry part
  local -a parts
  # Read the listings completely first: a reader that stops early could hide a
  # tar failure, and an unreadable archive must be refused, not skipped.
  names="$(tar -tzf "$archive")" || die "Archive cannot be listed: $archive"
  details="$(tar -tvzf "$archive")" || die "Archive cannot be listed: $archive"
  [[ -n "$names" ]] || die "Archive is empty: $archive"
  while IFS= read -r entry; do
    [[ "$entry" =~ ^[A-Za-z0-9_./-]+$ ]] || die "Archive entry has an unsupported name: $entry"
    IFS=/ read -r -a parts <<<"$entry"
    [[ "${parts[0]}" == "$name" ]] || die "Archive entry is outside the snapshot directory: $entry"
    for part in "${parts[@]}"; do
      [[ "$part" != "." && "$part" != ".." ]] || die "Archive entry escapes the snapshot directory: $entry"
    done
  done <<<"$names"
  while IFS= read -r entry; do
    [[ "$entry" == -* || "$entry" == d* ]] || die "Archive contains links or special files; refusing to extract."
  done <<<"$details"
}

run_data_tool() {
  docker run --rm --network none --user "$(id -u):$(id -g)" \
    -v "$ROOT_DIR/scripts/ops/data-backup.mjs:/tool/data-backup.mjs:ro" "$@"
}

restore_snapshot() {
  local source="$1" name archive sidecar snapshot_dir assets_target assets_parent remote_key db_sha bucket
  [[ -n "${RESTORE_ASSETS_TARGET:-}" ]] || die "RESTORE_ASSETS_TARGET is required: a NEW directory for the restored assets."
  assets_target="$(realpath -m "$RESTORE_ASSETS_TARGET")"
  assets_parent="$(dirname "$assets_target")"
  [[ ! -e "$assets_target" ]] || die "Assets restore target already exists: $assets_target. Restore never writes into an existing directory."
  [[ -d "$assets_parent" ]] || die "Parent directory of the assets restore target does not exist: $assets_parent"

  # Name, active-database and emptiness checks before anything is downloaded.
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" bash "$ROOT_DIR/scripts/ops/mysql-restore.sh" --preflight

  mkdir -p "$BACKUP_ROOT/restore"
  RESTORE_WORK_DIR="$(mktemp -d "$BACKUP_ROOT/restore/work.XXXXXXXX")"
  # The work copy holds a full database dump; never leave it behind.
  trap 'rm -rf "$RESTORE_WORK_DIR"' EXIT

  if [[ -d "$source" ]]; then
    snapshot_dir="$(cd "$source" && pwd -P)"
    name="$(basename "$snapshot_dir")"
    validate_snapshot_name "$name"
  else
    if [[ -f "$source" ]]; then
      archive="$source"
      sidecar="$source.sha256"
      name="$(basename "$source" .tar.gz)"
      [[ "$source" == *.tar.gz ]] || die "Local snapshot archives end in .tar.gz: $source"
      validate_snapshot_name "$name"
    else
      if [[ "$source" == s3://* ]]; then
        bucket="${source#s3://}"
        remote_key="${bucket#*/}"
        bucket="${bucket%%/*}"
        [[ "$bucket" == "$(require_backup_env_value BACKUP_S3_BUCKET)" ]] || die "Remote restore bucket must match BACKUP_S3_BUCKET."
        [[ "$remote_key" == *.tar.gz ]] || die "Remote snapshot keys end in .tar.gz: $source"
        name="$(basename "$remote_key" .tar.gz)"
      else
        name="$source"
        remote_key="$(remote_data_prefix)$name.tar.gz"
      fi
      validate_snapshot_name "$name"
      archive="$RESTORE_WORK_DIR/$name.tar.gz"
      sidecar="$archive.sha256"
      # Sidecar first: it is uploaded last, so its absence means an incomplete upload.
      bash "$ROOT_DIR/scripts/ops/object-storage.sh" download "$remote_key.sha256" "$sidecar" \
        || die "Checksum sidecar for $name could not be downloaded: the snapshot is incomplete or does not exist."
      bash "$ROOT_DIR/scripts/ops/object-storage.sh" download "$remote_key" "$archive" \
        || die "Snapshot archive $remote_key could not be downloaded."
    fi
    verify_archive_checksum "$archive" "$sidecar" "$name"
    validate_archive_entries "$archive" "$name"
    mkdir "$RESTORE_WORK_DIR/extract"
    tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$RESTORE_WORK_DIR/extract"
    snapshot_dir="$RESTORE_WORK_DIR/extract/$name"
    [[ -d "$snapshot_dir" ]] || die "Archive does not contain the snapshot directory $name"
  fi

  run_data_tool -v "$snapshot_dir:/snapshot:ro" "$NODE_IMAGE" \
    node /tool/data-backup.mjs verify --backup /snapshot
  # The manifest check above covered mysql.sql.gz; mysql-restore.sh hashes it again before import.
  db_sha="$(sha256sum "$snapshot_dir/mysql.sql.gz" | cut -d' ' -f1)"
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" BACKUP_EXPECTED_SHA256="$db_sha" \
    bash "$ROOT_DIR/scripts/ops/mysql-restore.sh" "$snapshot_dir/mysql.sql.gz"
  echo "Database restored into ${RESTORE_DATABASE}"

  run_data_tool -v "$snapshot_dir:/snapshot:ro" -v "$assets_parent:/restore-parent" "$NODE_IMAGE" \
    node /tool/data-backup.mjs restore-assets --backup /snapshot --target "/restore-parent/$(basename "$assets_target")" >/dev/null
  echo "Assets restored into $assets_target/assets"
  echo "Snapshot $name restored. Live database and asset storage were not modified."
}

case "${1:-}" in
  list)
    [[ $# -eq 1 ]] || usage
    list_snapshots
    ;;
  restore)
    [[ $# -eq 2 ]] || usage
    restore_snapshot "$2"
    ;;
  *)
    usage
    ;;
esac
