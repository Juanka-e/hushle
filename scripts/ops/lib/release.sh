#!/usr/bin/env bash
# Release bookkeeping for scripts/ops/deploy.sh.
#
# - Every release is a full commit SHA. Its images are tagged hushle-<service>:<sha>
#   and are never rebuilt once they exist; hushle-<service>:current points at the
#   live release, so cron jobs and operator commands use the same code.
# - $DEPLOY_STATE_DIR (default .deploy/) keeps `current`, `previous`, an append-only
#   history.log and an immutable record per release (its compose file and the list
#   of migrations it ships).
# - Migrations are forward-only. A release may only run against a database whose
#   applied migrations it knows; otherwise the deploy or rollback is refused.
# - Switching waits for container health, then for /api/health through nginx. A
#   failed switch returns to the release that was running.
#
# Callers set ROOT_DIR, ENV_FILE and COMPOSE_FILE first.

RELEASE_STATE_DIR="${DEPLOY_STATE_DIR:-$ROOT_DIR/.deploy}"
RELEASE_WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-180}"
RELEASE_HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-120}"
RELEASE_HEALTH_INTERVAL="${DEPLOY_HEALTH_INTERVAL:-3}"
RELEASE_HEALTH_URL="${DEPLOY_HEALTH_URL:-https://127.0.0.1/api/health}"
RELEASE_SERVICES=(app jobs migrate)
RELEASE_RUNNING=""

release_log() {
  printf '[release] %s\n' "$*"
}

release_fail() {
  printf '[release] ERROR: %s\n' "$*" >&2
  exit 1
}

release_history() {
  printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}" >> "$RELEASE_STATE_DIR/history.log"
}

release_read() {
  if [[ -f "$RELEASE_STATE_DIR/$1" ]]; then
    tr -d '[:space:]' < "$RELEASE_STATE_DIR/$1"
  fi
}

# Replaced atomically so a crash never leaves a half-written pointer.
release_write() {
  printf '%s\n' "$2" > "$RELEASE_STATE_DIR/.$1.tmp"
  mv -f "$RELEASE_STATE_DIR/.$1.tmp" "$RELEASE_STATE_DIR/$1"
}

release_compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Uses the compose file recorded with the release, so a rollback also restores
# that release's service definitions. Paths still resolve against ROOT_DIR.
release_compose_for() {
  local sha="$1"
  shift
  docker compose --env-file "$ENV_FILE" -f "$RELEASE_STATE_DIR/releases/$sha/docker-compose.yml" \
    --project-directory "$ROOT_DIR" "$@"
}

release_lock() {
  mkdir -p "$RELEASE_STATE_DIR/releases"
  exec {RELEASE_LOCK_FD}>"$RELEASE_STATE_DIR/deploy.lock"
  if ! flock -n "$RELEASE_LOCK_FD"; then
    release_fail "Another deploy or rollback is running ($RELEASE_STATE_DIR/deploy.lock)."
  fi
}

release_image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

release_tree_migrations() {
  local dir
  for dir in "$ROOT_DIR"/prisma/migrations/*/; do
    if [[ -f "$dir/migration.sql" ]]; then
      basename "$dir"
    fi
  done | LC_ALL=C sort
}

# Records the extracted tree as an immutable release; a second record for the
# same SHA must describe exactly the same release.
release_record() {
  local sha="$1" dir="$RELEASE_STATE_DIR/releases/$1" staged
  if [[ -d "$dir" ]]; then
    if ! cmp -s "$dir/migrations.txt" <(release_tree_migrations) || ! cmp -s "$dir/docker-compose.yml" "$COMPOSE_FILE"; then
      release_fail "The extracted tree differs from the recorded release $sha; refusing to change an immutable release."
    fi
    return
  fi
  staged="$(mktemp -d "$RELEASE_STATE_DIR/releases/.new.XXXXXX")"
  release_tree_migrations > "$staged/migrations.txt"
  cp "$COMPOSE_FILE" "$staged/docker-compose.yml"
  printf '%s\n' "$sha" > "$staged/sha"
  chmod 0444 "$staged/migrations.txt" "$staged/docker-compose.yml" "$staged/sha"
  mv "$staged" "$dir"
}

release_mysql_query() {
  release_compose exec -T mysql sh -lc \
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -N -B -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"' sh "$1"
}

# Every migration row that was not rolled back, including unfinished ones: a
# half-applied migration is still schema the target release must know.
release_applied_migrations() {
  local table_count
  if [[ -z "$(release_compose ps -aq mysql 2>/dev/null)" ]]; then
    return 0
  fi
  if [[ -z "$(release_compose ps -q mysql 2>/dev/null)" ]]; then
    release_compose up -d --wait --wait-timeout 120 mysql >&2
  fi
  table_count="$(release_mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'")"
  table_count="$(tr -d '[:space:]' <<<"$table_count")"
  [[ "$table_count" =~ ^[0-9]+$ ]] || return 1
  if [[ "$table_count" == "0" ]]; then
    return 0
  fi
  release_mysql_query "SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL"
}

release_assert_schema_known() {
  local sha="$1" context="$2" applied unknown
  if ! applied="$(release_applied_migrations)"; then
    release_fail "Could not read the applied migrations from MySQL; refusing to $context without a schema check."
  fi
  unknown="$(LC_ALL=C comm -23 <(printf '%s\n' "$applied" | tr -d '\r' | sed '/^$/d' | LC_ALL=C sort -u) \
    "$RELEASE_STATE_DIR/releases/$sha/migrations.txt" | paste -sd, -)"
  if [[ -z "$unknown" ]]; then
    release_log "Schema check passed: release $sha knows every applied migration."
    return 0
  fi
  if [[ "${ALLOW_NEWER_SCHEMA_MIGRATIONS:-}" == "$unknown" ]]; then
    release_log "WARNING: release $sha does not know the applied migrations $unknown; continuing because ALLOW_NEWER_SCHEMA_MIGRATIONS names exactly them."
    release_history "schema-override" "$sha" "$context:$unknown"
    return 0
  fi
  release_history "schema-refused" "$sha" "$context:$unknown"
  printf '[release] ERROR: Refusing to %s: the database has migrations that release %s does not know: %s\n' "$context" "$sha" "$unknown" >&2
  printf '[release] Migrations are forward-only. Deploy a release that contains them, or restore the pre-migration backup into an isolated database (docs/deploy/release-process.md, "Sema geri donusu").\n' >&2
  printf '[release] Only if these migrations were reviewed as additive (expand-only) for this release: ALLOW_NEWER_SCHEMA_MIGRATIONS=%s\n' "$unknown" >&2
  exit 1
}

release_health_header() {
  local token
  token="$(grep -m 1 -E '^HEALTHCHECK_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)"
  token="${token%\"}"
  token="${token#\"}"
  token="${token%\'}"
  token="${token#\'}"
  [[ -n "$token" ]] || release_fail "HEALTHCHECK_TOKEN is missing from $ENV_FILE."
  # A header file keeps the token out of the process list.
  RELEASE_HEALTH_HEADER="$(mktemp "$RELEASE_STATE_DIR/.health-header.XXXXXX")"
  printf 'x-health-token: %s\n' "$token" > "$RELEASE_HEALTH_HEADER"
}

# Healthy means: the app container runs this release's image and /api/health,
# reached through nginx, answers 200 with status "ok".
release_wait_healthy() {
  local sha="$1" expected container running response code="" body deadline
  expected="$(release_image_id "hushle-app:$sha")"
  deadline=$((SECONDS + RELEASE_HEALTH_TIMEOUT))
  while :; do
    container="$(release_compose_for "$sha" ps -q app 2>/dev/null || true)"
    running="$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)"
    if [[ -n "$expected" && "$running" == "$expected" ]]; then
      response="$(curl --silent --insecure --max-time 5 -H "@$RELEASE_HEALTH_HEADER" \
        --write-out '\n%{http_code}' "$RELEASE_HEALTH_URL" 2>/dev/null || true)"
      code="${response##*$'\n'}"
      body="${response%$'\n'*}"
      if [[ "$code" == "200" && "$body" == '{"status":"ok"'* ]]; then
        release_log "Release $sha is healthy."
        return 0
      fi
    fi
    if (( SECONDS >= deadline )); then
      release_log "Release $sha did not become healthy within ${RELEASE_HEALTH_TIMEOUT}s (app image ${running:-none}, health HTTP ${code:-none})."
      return 1
    fi
    sleep "$RELEASE_HEALTH_INTERVAL"
  done
}

# Points :current at the release, recreates the stack from its recorded compose
# file without building, reloads nginx (it resolves the app address only at
# load time) and waits for health. Returns non-zero instead of exiting.
release_switch() {
  local sha="$1" service
  if ! release_image_id "hushle-app:$sha" >/dev/null; then
    release_log "Image hushle-app:$sha is missing."
    return 1
  fi
  for service in "${RELEASE_SERVICES[@]}"; do
    if release_image_id "hushle-$service:$sha" >/dev/null; then
      docker tag "hushle-$service:$sha" "hushle-$service:current"
    fi
  done
  if ! (unset HUSHLE_RELEASE; release_compose_for "$sha" up -d --no-build --remove-orphans --wait --wait-timeout "$RELEASE_WAIT_TIMEOUT"); then
    release_log "Containers of $sha did not start healthy."
    return 1
  fi
  if ! release_compose_for "$sha" exec -T nginx nginx -s reload >/dev/null 2>&1; then
    release_log "WARNING: nginx reload failed; the health check decides."
  fi
  release_wait_healthy "$sha"
}

# Keeps the images of the current and previous release; older release images go.
release_prune_images() {
  local current previous service tag
  current="$(release_read current)"
  previous="$(release_read previous)"
  for service in "${RELEASE_SERVICES[@]}"; do
    while IFS= read -r tag; do
      [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || continue
      [[ "$tag" == "$current" || "$tag" == "$previous" ]] && continue
      if docker image rm "hushle-$service:$tag" >/dev/null 2>&1; then
        release_log "Removed old release image hushle-$service:$tag"
      fi
    done < <(docker image ls --format '{{.Tag}}' "hushle-$service" 2>/dev/null || true)
  done
}

release_begin_deploy() {
  local requested="${1:-}" sha
  [[ -f "$ROOT_DIR/.release-sha" ]] || release_fail "Missing .release-sha: production deploys come from a release archive."
  sha="$(tr -d '[:space:]' < "$ROOT_DIR/.release-sha")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || release_fail ".release-sha does not hold a full commit SHA."
  if [[ -n "$requested" && "$requested" != "$sha" ]]; then
    release_fail "Requested release $requested, but the extracted tree is $sha."
  fi
  release_lock
  RELEASE_RUNNING="$(release_read current)"
  export HUSHLE_RELEASE="$sha"
  release_record "$sha"
  release_health_header
  trap 'rm -f "$RELEASE_HEALTH_HEADER"' EXIT
  if [[ "$RELEASE_RUNNING" == "$sha" ]]; then
    release_log "Redeploying the running release $sha."
  else
    release_log "Deploying $sha (running: ${RELEASE_RUNNING:-none})."
  fi
  release_history "deploy-start" "$sha" "running=${RELEASE_RUNNING:-none}"
  if release_image_id "hushle-app:$sha" >/dev/null; then
    release_log "Image hushle-app:$sha exists; releases are immutable, so it is not rebuilt."
  else
    release_compose build app
  fi
}

release_finish_deploy() {
  local sha="$HUSHLE_RELEASE" running="$RELEASE_RUNNING"
  if release_switch "$sha"; then
    if [[ "$running" != "$sha" ]]; then
      if [[ -n "$running" ]]; then
        release_write previous "$running"
      fi
      release_write current "$sha"
    fi
    release_history "deploy" "$sha" "ok"
    release_prune_images
    release_log "Release $sha is live (previous: $(release_read previous))."
    return 0
  fi
  release_history "deploy" "$sha" "unhealthy"
  if [[ -n "$running" && "$running" != "$sha" ]]; then
    # The running release kept serving while the migrations ran, so it is
    # returned to even if this release added migrations (they stay applied).
    release_log "Returning to the release that was running: $running"
    if release_switch "$running"; then
      release_history "auto-revert" "$running" "ok"
      release_fail "Deploy of $sha failed its health check; $running is live again. Migrations applied by $sha stay applied."
    fi
    release_history "auto-revert" "$running" "failed"
    release_fail "Deploy of $sha failed and returning to $running failed too. Follow docs/deploy/rollback-and-incident.md."
  fi
  release_fail "Deploy of $sha failed its health check and there is no other release to return to."
}

release_rollback() {
  local current previous
  release_lock
  current="$(release_read current)"
  previous="$(release_read previous)"
  [[ -n "$current" ]] || release_fail "No current release is recorded in $RELEASE_STATE_DIR; nothing to roll back."
  [[ -n "$previous" ]] || release_fail "No previous release to roll back to (current: $current)."
  if [[ ! -f "$RELEASE_STATE_DIR/releases/$previous/docker-compose.yml" || ! -f "$RELEASE_STATE_DIR/releases/$previous/migrations.txt" ]]; then
    release_fail "The release record of $previous is missing."
  fi
  if ! release_image_id "hushle-app:$previous" >/dev/null; then
    release_fail "Image hushle-app:$previous is gone; redeploy that commit from the workflow instead."
  fi
  release_health_header
  trap 'rm -f "$RELEASE_HEALTH_HEADER"' EXIT
  acquire_schema_ops_lock "$ROOT_DIR" "production-rollback"
  release_assert_schema_known "$previous" "roll back"
  release_log "Rolling back $current -> $previous (no rebuild, no migration)."
  release_history "rollback-start" "$previous" "from=$current"
  if release_switch "$previous"; then
    release_write current "$previous"
    rm -f "$RELEASE_STATE_DIR/previous"
    release_history "rollback" "$previous" "ok from=$current"
    release_log "Rolled back to $previous. Roll forward by redeploying $current from the workflow."
    return 0
  fi
  release_history "rollback" "$previous" "unhealthy"
  release_log "Returning to the release that was running: $current"
  if release_switch "$current"; then
    release_history "auto-revert" "$current" "ok"
    release_fail "Rollback to $previous failed its health check; $current is live again."
  fi
  release_history "auto-revert" "$current" "failed"
  release_fail "Rollback to $previous failed and returning to $current failed too. Follow docs/deploy/rollback-and-incident.md."
}

release_status() {
  local name sha service
  for name in current previous; do
    sha="$(release_read "$name")"
    printf '%-8s %s' "$name" "${sha:-none}"
    if [[ -n "$sha" ]]; then
      for service in "${RELEASE_SERVICES[@]}"; do
        if release_image_id "hushle-$service:$sha" >/dev/null; then
          printf ' %s=present' "$service"
        else
          printf ' %s=missing' "$service"
        fi
      done
    fi
    printf '\n'
  done
  if [[ -f "$RELEASE_STATE_DIR/history.log" ]]; then
    echo "history (latest 10):"
    tail -n 10 "$RELEASE_STATE_DIR/history.log"
  fi
}
