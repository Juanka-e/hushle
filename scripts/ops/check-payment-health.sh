#!/usr/bin/env bash
set -euo pipefail

HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
HEALTHCHECK_TOKEN="${HEALTHCHECK_TOKEN:-}"

if [[ -z "$HEALTHCHECK_URL" || -z "$HEALTHCHECK_TOKEN" ]]; then
  echo "HEALTHCHECK_URL and HEALTHCHECK_TOKEN are required" >&2
  exit 64
fi
if [[ "$HEALTHCHECK_URL" != https://* && "${ALLOW_INSECURE_HEALTHCHECK:-false}" != "true" ]]; then
  echo "HEALTHCHECK_URL must use HTTPS" >&2
  exit 64
fi
if (( ${#HEALTHCHECK_TOKEN} < 32 || ${#HEALTHCHECK_TOKEN} > 256 )) \
  || [[ "$HEALTHCHECK_TOKEN" == *$'\n'* || "$HEALTHCHECK_TOKEN" == *$'\r'* ]]; then
  echo "HEALTHCHECK_TOKEN must be 32-256 characters without line breaks" >&2
  exit 64
fi
for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 69
  fi
done

response_file="$(mktemp)"
curl_config="$(mktemp)"
cleanup() {
  rm -f "$response_file" "$curl_config"
}
trap cleanup EXIT
chmod 600 "$response_file" "$curl_config"
escaped_token="${HEALTHCHECK_TOKEN//\\/\\\\}"
escaped_token="${escaped_token//\"/\\\"}"
printf 'header = "x-health-token: %s"\n' "$escaped_token" > "$curl_config"

http_status="$(curl --config "$curl_config" --silent --show-error \
  --connect-timeout "${HEALTHCHECK_CONNECT_TIMEOUT_SECONDS:-5}" \
  --max-time "${HEALTHCHECK_TIMEOUT_SECONDS:-10}" \
  --output "$response_file" --write-out '%{http_code}' "$HEALTHCHECK_URL")"

if [[ "$http_status" != "200" ]]; then
  echo "Health endpoint returned HTTP $http_status" >&2
  exit 1
fi

if ! jq -e '
  .status == "ok"
  and (.payments.schedulers | type == "array")
  and (.payments.schedulers | length == 2)
  and (.payments.schedulers | all(.status == "healthy"))
' "$response_file" >/dev/null; then
  echo "Payment scheduler health is not ready" >&2
  jq -c '{status, schedulers: .payments.schedulers}' "$response_file" >&2 || true
  exit 1
fi

echo "Payment scheduler health is ready"
