#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-/srv/hushle/app}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
ENABLE=false

if [[ "${1:-}" == "--enable" ]]; then
  ENABLE=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--enable]" >&2
  exit 64
fi
if (( EUID != 0 )); then
  echo "Run this installer as root" >&2
  exit 77
fi
if [[ "$ROOT_DIR" != "/srv/hushle/app" ]]; then
  echo "Systemd units use the canonical APP_DIR=/srv/hushle/app" >&2
  exit 78
fi
if ! id hushle >/dev/null 2>&1; then
  echo "Missing system user: hushle" >&2
  exit 67
fi
if [[ ! -x "$ROOT_DIR/scripts/ops/run-payment-job.sh" ]]; then
  echo "Payment job wrapper is missing or not executable" >&2
  exit 66
fi

units=(
  hushle-payment-webhook.service
  hushle-payment-webhook.timer
  hushle-payment-reconciliation.service
  hushle-payment-reconciliation.timer
)
for unit in "${units[@]}"; do
  source_file="$ROOT_DIR/infra/systemd/$unit"
  if [[ ! -f "$source_file" ]]; then
    echo "Missing unit file: $source_file" >&2
    exit 66
  fi
  install -o root -g root -m 0644 "$source_file" "$SYSTEMD_DIR/$unit"
done

systemctl daemon-reload
if [[ "$ENABLE" == "true" ]]; then
  systemctl enable --now \
    hushle-payment-webhook.timer \
    hushle-payment-reconciliation.timer
else
  echo "Units installed but not enabled. Re-run with --enable after production preflight."
fi
