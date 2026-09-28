#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

export SCHEMA_OPS_LOCK_DIR="$TMP_DIR/locks"
export SCHEMA_OPS_LOCK_TIMEOUT_SECONDS=2
# shellcheck source=scripts/ops/lib/schema-ops-lock.sh
source "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh"

(
  acquire_schema_ops_shared_lock "$ROOT_DIR" first >/dev/null
  sleep 1
  release_schema_ops_lock
) &
holder_pid=$!
sleep 0.1

acquire_schema_ops_shared_lock "$ROOT_DIR" second >/dev/null
release_schema_ops_lock

export SCHEMA_OPS_LOCK_TIMEOUT_SECONDS=0
if acquire_schema_ops_lock "$ROOT_DIR" blocked >/dev/null 2>&1; then
  echo "Exclusive lock was acquired while a shared payment lock was active" >&2
  exit 1
fi

wait "$holder_pid"
acquire_schema_ops_lock "$ROOT_DIR" exclusive >/dev/null
release_schema_ops_lock

set +e
APP_DIR="$ROOT_DIR" "$ROOT_DIR/scripts/ops/run-payment-job.sh" unsupported >/dev/null 2>&1
unsupported_status=$?
set -e
if [[ "$unsupported_status" -ne 64 ]]; then
  echo "Unsupported payment job did not fail with status 64" >&2
  exit 1
fi

cat > "$TMP_DIR/disabled.env" <<'EOF'
JOBS_ENABLED=true
PAYMENT_WEBHOOK_SCHEDULE_CONFIGURED=false
PAYMENT_RECONCILIATION_SCHEDULE_CONFIGURED=false
EOF
set +e
APP_DIR="$ROOT_DIR" ENV_FILE="$TMP_DIR/disabled.env" \
  "$ROOT_DIR/scripts/ops/run-payment-job.sh" payment-webhook >/dev/null 2>&1
disabled_status=$?
set -e
if [[ "$disabled_status" -ne 78 ]]; then
  echo "Disabled payment schedule did not fail with status 78" >&2
  exit 1
fi

set +e
HEALTHCHECK_URL=http://localhost/api/health HEALTHCHECK_TOKEN=test \
  "$ROOT_DIR/scripts/ops/check-payment-health.sh" >/dev/null 2>&1
insecure_status=$?
set -e
if [[ "$insecure_status" -ne 64 ]]; then
  echo "Insecure health URL did not fail with status 64" >&2
  exit 1
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  mkdir -p "$TMP_DIR/systemd"
  cp "$ROOT_DIR"/infra/systemd/hushle-payment-* "$TMP_DIR/systemd/"
  chmod 0644 "$TMP_DIR/systemd"/*
  sed -i \
    -e '/^Requires=docker.service$/d' \
    -e 's/^After=docker.service network-online.target$/After=network-online.target/' \
    -e '/^User=hushle$/d' \
    -e '/^Group=hushle$/d' \
    -e 's#^WorkingDirectory=.*#WorkingDirectory=/tmp#' \
    -e 's#^ExecStart=.*#ExecStart=/bin/true#' \
    "$TMP_DIR/systemd"/*.service
  systemd-analyze verify \
    "$TMP_DIR/systemd"/hushle-payment-*.service \
    "$TMP_DIR/systemd"/hushle-payment-*.timer
fi

echo "Payment scheduler shell behavior checks passed."
