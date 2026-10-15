#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
REQUIRED_ENV_KEYS=(
  DATABASE_URL
  AUTH_SECRET
  NEXTAUTH_URL
  NEXT_PUBLIC_SITE_URL
  MYSQL_ROOT_PASSWORD
  MYSQL_PASSWORD
  HEALTHCHECK_TOKEN
)

# shellcheck source=scripts/ops/lib/schema-ops-lock.sh
source "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh"
# shellcheck source=scripts/ops/lib/release.sh
source "$ROOT_DIR/scripts/ops/lib/release.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"

# deploy [sha]: deploy the extracted release (.release-sha); the default.
# rollback: switch back to the previous release without rebuilding.
# status: print the current and previous release.
case "${1:-deploy}" in
  deploy)
    ;;
  rollback)
    [[ $# -eq 1 ]] || release_fail "Usage: deploy.sh rollback"
    release_rollback
    exit 0
    ;;
  status)
    release_status
    exit 0
    ;;
  *)
    release_fail "Usage: deploy.sh [deploy [sha] | rollback | status]"
    ;;
esac

preflight_mounts=(
  -v "$ROOT_DIR:/app:ro"
  -v "$ENV_FILE:/run/production.env:ro"
)
if grep -Eq '^PAYMENTS_ENABLED=[[:space:]]*true[[:space:]]*$' "$ENV_FILE"; then
  evidence_dir="$(grep -E '^PAYMENT_EVIDENCE_DIR=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  evidence_dir="${evidence_dir%\"}"
  evidence_dir="${evidence_dir#\"}"
  evidence_dir="${evidence_dir%\'}"
  evidence_dir="${evidence_dir#\'}"
  if [[ "$evidence_dir" != /* || "$evidence_dir" == *:* || ! -d "$evidence_dir" ]]; then
    echo "PAYMENT_EVIDENCE_DIR must be an existing absolute directory" >&2
    exit 1
  fi
  evidence_dir="$(cd "$evidence_dir" && pwd -P)"
  preflight_mounts+=(-v "$evidence_dir:$evidence_dir:ro")
fi

docker run --rm --network none \
  "${preflight_mounts[@]}" \
  -w /app \
  node:20-alpine \
  node scripts/production-preflight.mjs /run/production.env

for key in "${REQUIRED_ENV_KEYS[@]}"; do
  if ! grep -Eq "^${key}=.+$" "$ENV_FILE"; then
    echo "Missing required env entry in $ENV_FILE: $key" >&2
    exit 1
  fi
done

if ! grep -Eq '^REDIS_URL=.+$' "$ENV_FILE"; then
  echo "REDIS_URL not set explicitly in $ENV_FILE. Falling back to docker internal default redis://redis:6379." >&2
fi

# Takes the deploy lock, records the release and builds its app image once.
# HUSHLE_RELEASE tags the images built below with the release SHA.
release_begin_deploy "${2:-}"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull mysql redis nginx
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration build migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile jobs build jobs
acquire_schema_ops_lock "$ROOT_DIR" "production-deploy"
release_assert_schema_known "$HUSHLE_RELEASE" "deploy"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate
release_finish_deploy
docker image prune -f >/dev/null 2>&1 || true
