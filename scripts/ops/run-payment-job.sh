#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
JOB="${1:-}"
TIMEOUT_SECONDS="${PAYMENT_JOB_TIMEOUT_SECONDS:-600}"

# shellcheck source=scripts/ops/lib/schema-ops-lock.sh
source "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh"

case "$JOB" in
  payment-webhook)
    SCHEDULE_KEY="PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED"
    ;;
  payment-reconciliation)
    SCHEDULE_KEY="PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED"
    ;;
  *)
    echo "Unsupported payment job: ${JOB:-missing}" >&2
    exit 64
    ;;
esac

if [[ ! "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( TIMEOUT_SECONDS < 60 || TIMEOUT_SECONDS > 3600 )); then
  echo "PAYMENT_JOB_TIMEOUT_SECONDS must be an integer between 60 and 3600" >&2
  exit 64
fi

for file in "$ENV_FILE" "$COMPOSE_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 66
  fi
done

if ! grep -Eq '^JOBS_ENABLED=[[:space:]]*true[[:space:]]*$' "$ENV_FILE"; then
  echo "JOBS_ENABLED=true is required in $ENV_FILE" >&2
  exit 78
fi
if ! grep -Eq "^${SCHEDULE_KEY}=[[:space:]]*true[[:space:]]*$" "$ENV_FILE"; then
  echo "${SCHEDULE_KEY}=true is required in $ENV_FILE" >&2
  exit 78
fi

cd "$ROOT_DIR"
acquire_schema_ops_shared_lock "$ROOT_DIR" "payment-job:$JOB"
trap release_schema_ops_lock EXIT
timeout --signal=TERM --kill-after=30s "$TIMEOUT_SECONDS" \
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  --profile jobs run --rm --no-deps jobs \
  npm run jobs:run -- "$JOB" execute
