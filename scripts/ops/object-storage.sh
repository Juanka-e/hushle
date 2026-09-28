#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
OPS_COMPOSE_FILE="${OPS_COMPOSE_FILE:-$ROOT_DIR/docker-compose.ops.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"

# shellcheck source=scripts/ops/lib/backup-env.sh
source "$ROOT_DIR/scripts/ops/lib/backup-env.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  object-storage.sh upload <local-file> <remote-key>
  object-storage.sh download <remote-key> <local-file>
  object-storage.sh size <remote-key>
EOF
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

COMMAND="$1"
BACKUP_S3_BUCKET="$(require_backup_env_value BACKUP_S3_BUCKET)"
BACKUP_S3_ENDPOINT="$(read_backup_env_value BACKUP_S3_ENDPOINT)"
BACKUP_S3_REGION="$(read_backup_env_value BACKUP_S3_REGION auto)"
BACKUP_S3_CLI_MODE="$(read_backup_env_value BACKUP_S3_CLI_MODE docker)"
BACKUP_S3_CLI="$(read_backup_env_value BACKUP_S3_CLI aws)"

aws_cli() {
  local global_args=(--no-cli-pager)
  if [[ -n "$BACKUP_S3_ENDPOINT" ]]; then
    global_args+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  fi

  if [[ "$BACKUP_S3_CLI_MODE" == "host" ]]; then
    export AWS_ACCESS_KEY_ID
    export AWS_SECRET_ACCESS_KEY
    export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
    AWS_ACCESS_KEY_ID="$(require_backup_env_value BACKUP_S3_ACCESS_KEY_ID)"
    AWS_SECRET_ACCESS_KEY="$(require_backup_env_value BACKUP_S3_SECRET_ACCESS_KEY)"
    "$BACKUP_S3_CLI" "${global_args[@]}" "$@"
    return
  fi

  if [[ "$BACKUP_S3_CLI_MODE" != "docker" ]]; then
    echo "BACKUP_S3_CLI_MODE must be docker or host." >&2
    exit 1
  fi

  export BACKUP_OPS_UID="${BACKUP_OPS_UID:-$(id -u)}"
  export BACKUP_OPS_GID="${BACKUP_OPS_GID:-$(id -g)}"

  docker compose \
    --env-file "$ENV_FILE" \
    -f "$OPS_COMPOSE_FILE" \
    --profile ops \
    run --rm --no-deps backup-cli \
    "${global_args[@]}" "$@"
}

container_path() {
  local local_file="$1"
  local absolute_file
  local absolute_root
  absolute_file="$(realpath -m "$local_file")"
  absolute_root="$(realpath -m "$BACKUP_ROOT")"

  if [[ "$absolute_file" != "$absolute_root/"* ]]; then
    echo "Docker backup files must stay under $absolute_root" >&2
    exit 1
  fi

  printf '/backups/%s' "${absolute_file#"$absolute_root/"}"
}

cli_path() {
  if [[ "$BACKUP_S3_CLI_MODE" == "host" ]]; then
    realpath -m "$1"
  else
    container_path "$1"
  fi
}

case "$COMMAND" in
  upload)
    [[ $# -eq 3 ]] || usage
    LOCAL_FILE="$2"
    REMOTE_KEY="$3"
    [[ -f "$LOCAL_FILE" ]] || {
      echo "Upload file not found: $LOCAL_FILE" >&2
      exit 1
    }
    aws_cli s3 cp "$(cli_path "$LOCAL_FILE")" "s3://$BACKUP_S3_BUCKET/$REMOTE_KEY" --only-show-errors
    REMOTE_SIZE="$(
      aws_cli s3api head-object \
        --bucket "$BACKUP_S3_BUCKET" \
        --key "$REMOTE_KEY" \
        --query ContentLength \
        --output text \
        | tr -d '[:space:]'
    )"
    LOCAL_SIZE="$(wc -c < "$LOCAL_FILE" | tr -d '[:space:]')"
    if [[ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]]; then
      echo "Remote size mismatch for $REMOTE_KEY: local=$LOCAL_SIZE remote=$REMOTE_SIZE" >&2
      exit 1
    fi
    ;;
  download)
    [[ $# -eq 3 ]] || usage
    REMOTE_KEY="$2"
    LOCAL_FILE="$3"
    mkdir -p "$(dirname "$LOCAL_FILE")"
    aws_cli s3 cp "s3://$BACKUP_S3_BUCKET/$REMOTE_KEY" "$(cli_path "$LOCAL_FILE")" --only-show-errors
    ;;
  size)
    [[ $# -eq 2 ]] || usage
    aws_cli s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$2" --query ContentLength --output text
    ;;
  *)
    usage
    ;;
esac
