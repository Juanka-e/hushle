#!/usr/bin/env bash
# Deploy, redeploy, rollback and release-gate behavior of scripts/ops/deploy.sh
# and scripts/ops/release-gate.sh against stubbed docker, docker compose and
# curl. The stubs keep a small fake world: tagged images, the image the app
# container runs, the applied Prisma migrations and which images are unhealthy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
for tool in flock jq; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

APP="$TEMP_DIR/app"
FAKE_BIN="$TEMP_DIR/bin"
export FAKE_STATE="$TEMP_DIR/fake"
STATE="$APP/.deploy"
PASSED=0
mkdir -p "$APP/scripts/ops/lib" "$APP/prisma/migrations" "$FAKE_BIN" "$FAKE_STATE/images"
cp "$ROOT_DIR/scripts/ops/deploy.sh" "$APP/scripts/ops/"
cp "$ROOT_DIR/scripts/ops/lib/schema-ops-lock.sh" "$ROOT_DIR/scripts/ops/lib/release.sh" "$APP/scripts/ops/lib/"
cp "$ROOT_DIR/docker-compose.yml" "$APP/"
cat > "$APP/.env.production" <<'EOF'
DATABASE_URL=mysql://hushle:secret@mysql:3306/hushle
AUTH_SECRET=test-auth-secret
NEXTAUTH_URL=https://hushle.example
NEXT_PUBLIC_SITE_URL=https://hushle.example
MYSQL_ROOT_PASSWORD=root-secret
MYSQL_PASSWORD=secret
HEALTHCHECK_TOKEN="test-health-token"
REDIS_URL=redis://redis:6379
EOF

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
S="$FAKE_STATE"
printf '%s\n' "$*" >> "$S/calls.log"
image_file() { printf '%s/images/%s' "$S" "${1//:/@}"; }
new_id() { printf 'sha256:%s' "$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"; }
last() { printf '%s' "${@: -1}"; }
case "$1" in
  run) exit 0 ;; # production preflight container
  tag)
    [[ -f "$(image_file "$2")" ]] || { echo "No such image: $2" >&2; exit 1; }
    cp "$(image_file "$2")" "$(image_file "$3")"
    exit 0
    ;;
  inspect)
    [[ "$(last "$@")" == "fake-app" && -s "$S/app_image" ]] || exit 1
    cat "$S/app_image"
    exit 0
    ;;
  image)
    case "$2" in
      inspect)
        [[ -f "$(image_file "$(last "$@")")" ]] || exit 1
        cat "$(image_file "$(last "$@")")"
        ;;
      ls)
        for file in "$S/images/$(last "$@")@"*; do
          [[ -e "$file" ]] && printf '%s\n' "${file##*@}"
        done
        ;;
      rm) rm -f "$(image_file "$(last "$@")")" ;;
      prune) ;;
      *) exit 1 ;;
    esac
    exit 0
    ;;
  compose) shift ;;
  *) echo "fake docker: unexpected $*" >&2; exit 97 ;;
esac
compose_file=""
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    -f) compose_file="$2"; shift 2 ;;
    --env-file | --project-directory | --profile) shift 2 ;;
    *) break ;;
  esac
done
[[ "${1:-}" == "-f" ]] && { compose_file="$2"; shift 2; }
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --project-directory | --profile) shift 2 ;;
    *) break ;;
  esac
done
command="$1"
shift
case "$command" in
  pull) ;;
  build)
    [[ -z "${FAKE_BUILD_FAIL:-}" ]] || exit 1
    new_id > "$(image_file "hushle-$1:${HUSHLE_RELEASE:-current}")"
    if [[ "$1" == app && -n "${FAKE_UNHEALTHY_RELEASE:-}" && "${HUSHLE_RELEASE:-}" == "$FAKE_UNHEALTHY_RELEASE" ]]; then
      cat "$(image_file "hushle-app:$HUSHLE_RELEASE")" >> "$S/unhealthy"
    fi
    ;;
  run)
    [[ -z "${FAKE_MIGRATE_FAIL:-}" ]] || exit 1
    [[ -f "$(image_file "hushle-migrate:${HUSHLE_RELEASE:-current}")" ]] || { echo "migrate image missing" >&2; exit 1; }
    for dir in "$PWD"/prisma/migrations/*/; do basename "$dir"; done >> "$S/applied"
    sort -u -o "$S/applied" "$S/applied"
    ;;
  ps)
    service="$(last "$@")"
    if [[ "$service" == "mysql" && -f "$S/mysql" ]]; then echo fake-mysql; fi
    if [[ "$service" == "app" && -s "$S/app_image" ]]; then echo fake-app; fi
    ;;
  up)
    if [[ "$(last "$@")" == "mysql" ]]; then touch "$S/mysql"; exit 0; fi
    [[ -z "${HUSHLE_RELEASE:-}" ]] || { echo "switch must use :current" >&2; exit 1; }
    [[ " $* " == *" --no-build "* ]] || { echo "switch must not build" >&2; exit 1; }
    [[ -f "$(image_file hushle-app:current)" ]] || { echo "no current app image" >&2; exit 1; }
    # FAKE_UP_KEEPS_CONTAINER: compose reports success but keeps the old container.
    [[ -n "${FAKE_UP_KEEPS_CONTAINER:-}" ]] || cp "$(image_file hushle-app:current)" "$S/app_image"
    touch "$S/mysql"
    # A new nginx container resolves the app address once, at start.
    [[ -f "$S/nginx_target" ]] || cp "$S/app_image" "$S/nginx_target"
    printf '%s\n' "$compose_file" >> "$S/up.log"
    if grep -qxF "$(cat "$S/app_image")" "$S/crashing" 2>/dev/null; then exit 1; fi
    ;;
  exec)
    if [[ " $* " == *" nginx -s reload "* ]]; then
      echo reload >> "$S/nginx.log"
      cp "$S/app_image" "$S/nginx_target"
      exit 0
    fi
    sql="$(last "$@")"
    if [[ "$sql" == *information_schema.tables* ]]; then
      [[ -f "$S/applied" ]] && echo 1 || echo 0
    elif [[ "$sql" == *_prisma_migrations* ]]; then
      cat "$S/applied"
    else
      exit 1
    fi
    ;;
  *) echo "fake docker compose: unexpected $command $*" >&2; exit 97 ;;
esac
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
S="$FAKE_STATE"
printf 'curl %s\n' "$*" >> "$S/calls.log"
header=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-H" && "$2" == @* ]]; then header="${2#@}"; fi
  shift
done
if [[ "$(cat "$header" 2>/dev/null)" != "x-health-token: test-health-token" ]]; then
  printf '{"error":"Not found"}\n404'
  exit 0
fi
if ! cmp -s "$S/app_image" "$S/nginx_target"; then
  # nginx still proxies to the address of a container that is gone.
  printf '<html>502 Bad Gateway</html>\n502'
elif grep -qxF "$(cat "$S/app_image" 2>/dev/null)" "$S/unhealthy" 2>/dev/null; then
  printf '{"status":"degraded","uptime":1}\n200'
else
  printf '{"status":"ok","uptime":1}\n200'
fi
EOF
chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/curl"
touch "$FAKE_STATE/calls.log" "$FAKE_STATE/unhealthy" "$FAKE_STATE/crashing"

pass() {
  PASSED=$((PASSED + 1))
  printf '  ok %d - %s\n' "$PASSED" "$*"
}
fail() {
  echo "FAIL: $*" >&2
  exit 1
}
SHA_A="$(printf 'a%.0s' {1..40})"
SHA_B="$(printf 'b%.0s' {1..40})"
SHA_C="$(printf 'c%.0s' {1..40})"
SHA_D="$(printf 'd%.0s' {1..40})"
SHA_E="$(printf 'e%.0s' {1..40})"
SHA_F="$(printf '1%.0s' {1..40})"
M1="20260101000000_init"
M2="20260201000000_add_column"

# Simulates extracting a release archive: the tree and .release-sha change.
extract_release() {
  local sha="$1" migration
  shift
  rm -rf "$APP/prisma/migrations"
  mkdir -p "$APP/prisma/migrations"
  for migration in "$@"; do
    mkdir -p "$APP/prisma/migrations/$migration"
    printf -- '-- %s\n' "$migration" > "$APP/prisma/migrations/$migration/migration.sql"
  done
  printf '%s\n' "$sha" > "$APP/.release-sha"
}
# deploy_with VAR=value... -- deploy.sh arguments
deploy_with() {
  local -a vars=()
  while [[ "$1" != "--" ]]; do
    vars+=("$1")
    shift
  done
  shift
  (cd "$APP" && env PATH="$FAKE_BIN:$PATH" ENV_FILE="$APP/.env.production" \
    SCHEMA_OPS_LOCK_DIR="$TEMP_DIR/locks" DEPLOY_HEALTH_TIMEOUT=0 DEPLOY_HEALTH_INTERVAL=0 \
    "${vars[@]}" bash scripts/ops/deploy.sh "$@")
}
deploy_sh() { deploy_with -- "$@"; }
built_or_migrated() { grep -Eq ' build (app|jobs|migrate)$| run --rm migrate$' "$FAKE_STATE/calls.log"; }
mark() { : > "$FAKE_STATE/calls.log"; }
image_id() { cat "$FAKE_STATE/images/$1@$2" 2>/dev/null || true; }
running_sha() {
  local file
  for file in "$FAKE_STATE"/images/hushle-app@*; do
    [[ "${file##*@}" == "current" ]] && continue
    if [[ "$(cat "$file")" == "$(cat "$FAKE_STATE/app_image")" ]]; then printf '%s' "${file##*@}"; return; fi
  done
}
state() { if [[ -f "$STATE/$1" ]]; then tr -d '[:space:]' < "$STATE/$1"; fi; }
assert_live() {
  local sha="$1" label="$2"
  [[ "$(running_sha)" == "$sha" ]] || fail "$label: app runs $(running_sha), expected $sha"
  [[ "$(image_id hushle-app current)" == "$(image_id hushle-app "$sha")" ]] || fail "$label: :current does not point at $sha"
  [[ "$(state current)" == "$sha" ]] || fail "$label: state current is $(state current), expected $sha"
}
expect_failure() {
  local label="$1" pattern="$2" output="$TEMP_DIR/out.log"
  shift 2
  if "$@" >"$output" 2>&1; then
    cat "$output" >&2
    fail "$label: unexpectedly succeeded"
  fi
  if ! grep -Eq -- "$pattern" "$output"; then
    cat "$output" >&2
    fail "$label: output did not match /$pattern/"
  fi
}
run_ok() {
  local label="$1" output="$TEMP_DIR/out.log"
  shift
  if ! "$@" >"$output" 2>&1; then
    cat "$output" >&2
    fail "$label: failed"
  fi
}

echo "deploy.sh release flow"
extract_release "$SHA_A" "$M1"
mark
run_ok "first deploy" deploy_sh
assert_live "$SHA_A" "first deploy"
[[ -z "$(state previous)" ]] || fail "first deploy recorded a previous release"
grep -qx "compose build app" <(sed -E 's/--env-file [^ ]+ -f [^ ]+ //' "$FAKE_STATE/calls.log") || fail "app image was not built"
[[ "$(cat "$FAKE_STATE/applied")" == "$M1" ]] || fail "migration not applied"
[[ "$(cat "$STATE/releases/$SHA_A/migrations.txt")" == "$M1" ]] || fail "release record lacks its migrations"
cmp -s "$STATE/releases/$SHA_A/docker-compose.yml" "$APP/docker-compose.yml" || fail "release record lacks its compose file"
[[ "$(tail -n 1 "$FAKE_STATE/up.log")" == "$STATE/releases/$SHA_A/docker-compose.yml" ]] || fail "switch did not use the recorded compose file"
[[ "$(wc -l < "$FAKE_STATE/nginx.log")" == "1" ]] || fail "nginx was not reloaded after the switch"
grep -q 'curl .*-H @.*https://127.0.0.1/api/health' "$FAKE_STATE/calls.log" || fail "health was not probed through nginx"
if grep -q 'test-health-token' "$FAKE_STATE/calls.log"; then fail "health token leaked into a command line"; fi
[[ -z "$(find "$STATE" -name '.health-header.*')" ]] || fail "health header file left behind"
pass "first deploy builds, migrates, switches through :current, reloads nginx and checks health"

mark
run_ok "redeploy" deploy_sh
assert_live "$SHA_A" "redeploy"
if grep -q " build app$" "$FAKE_STATE/calls.log"; then fail "redeploy rebuilt the immutable app image"; fi
[[ -z "$(state previous)" ]] || fail "redeploy of the same SHA changed the previous release"
pass "redeploy of the running SHA keeps the app image and the rollback target"

extract_release "$SHA_B" "$M1"
run_ok "deploy B" deploy_sh
assert_live "$SHA_B" "deploy B"
[[ "$(state previous)" == "$SHA_A" ]] || fail "previous release not recorded"
pass "deploying a new SHA keeps the old one as previous"

mark
run_ok "rollback to A" deploy_sh rollback
assert_live "$SHA_A" "rollback"
if built_or_migrated; then fail "rollback built or migrated"; fi
[[ -z "$(state previous)" ]] || fail "rollback left a previous release"
[[ "$(tail -n 1 "$FAKE_STATE/up.log")" == "$STATE/releases/$SHA_A/docker-compose.yml" ]] || fail "rollback did not use A's compose file"
grep -q "rollback $SHA_A ok from=$SHA_B" "$STATE/history.log" || fail "rollback not in history"
pass "rollback switches to the previous release without building or migrating"

expect_failure "rollback without a previous release" "No previous release to roll back to" deploy_sh rollback
assert_live "$SHA_A" "refused rollback"
pass "rollback with no previous release is refused"

extract_release "$SHA_C" "$M1" "$M2"
run_ok "deploy C" deploy_sh
assert_live "$SHA_C" "deploy C"
[[ "$(state previous)" == "$SHA_A" ]] || fail "previous should be A"
[[ -z "$(image_id hushle-app "$SHA_B")" && -z "$(image_id hushle-jobs "$SHA_B")" ]] || fail "images of an old release were kept"
[[ -n "$(image_id hushle-app "$SHA_A")" ]] || fail "images of the previous release were removed"
pass "deploy prunes release images other than current and previous"

mark
expect_failure "rollback across a newer schema" "does not know: $M2" deploy_sh rollback
grep -q "pre-migration backup" "$TEMP_DIR/out.log" || fail "refusal does not point to the restore procedure"
if grep -q " up -d --no-build" "$FAKE_STATE/calls.log"; then fail "refused rollback switched containers"; fi
assert_live "$SHA_C" "schema-refused rollback"
expect_failure "override must name the exact migrations" "does not know" \
  deploy_with ALLOW_NEWER_SCHEMA_MIGRATIONS=yes -- rollback
assert_live "$SHA_C" "wrong override"
pass "rollback is refused when the database has migrations the previous release does not know"

run_ok "confirmed rollback" deploy_with ALLOW_NEWER_SCHEMA_MIGRATIONS="$M2" -- rollback
assert_live "$SHA_A" "confirmed rollback"
grep -q "schema-override $SHA_A roll back:$M2" "$STATE/history.log" || fail "override not recorded"
pass "an exact ALLOW_NEWER_SCHEMA_MIGRATIONS list allows the reviewed rollback and is recorded"

extract_release "$SHA_C" "$M1" "$M2"
mark
run_ok "roll forward to C" deploy_sh
assert_live "$SHA_C" "roll forward"
if grep -q " build app$" "$FAKE_STATE/calls.log"; then fail "roll forward rebuilt C"; fi
[[ "$(state previous)" == "$SHA_A" ]] || fail "roll forward previous"
pass "rolling forward redeploys the kept image"

extract_release "$SHA_D" "$M1" "$M2"
mark
# The stub marks D's app image unhealthy when deploy.sh builds it.
expect_failure "unhealthy deploy" "$SHA_C is live again" deploy_with FAKE_UNHEALTHY_RELEASE="$SHA_D" --
assert_live "$SHA_C" "auto-revert"
[[ "$(state previous)" == "$SHA_A" ]] || fail "failed deploy changed the previous release"
grep -q "auto-revert $SHA_C ok" "$STATE/history.log" || fail "auto-revert not recorded"
[[ "$(grep -c '' "$FAKE_STATE/up.log")" -ge 2 ]] || fail "no switch back happened"
pass "a deploy that fails its health check returns to the running release"

: > "$FAKE_STATE/unhealthy"
cat "$FAKE_STATE/images/hushle-app@$SHA_D" >> "$FAKE_STATE/crashing"
expect_failure "crashing containers" "$SHA_C is live again" deploy_sh
assert_live "$SHA_C" "crash revert"
: > "$FAKE_STATE/crashing"
pass "containers that fail compose --wait also return to the running release"

cat "$FAKE_STATE/images/hushle-app@$SHA_A" >> "$FAKE_STATE/unhealthy"
extract_release "$SHA_C" "$M1" "$M2"
expect_failure "unhealthy rollback" "Rollback to $SHA_A failed its health check; $SHA_C is live again" \
  deploy_with ALLOW_NEWER_SCHEMA_MIGRATIONS="$M2" -- rollback
assert_live "$SHA_C" "rollback revert"
[[ "$(state previous)" == "$SHA_A" ]] || fail "failed rollback lost the previous release"
: > "$FAKE_STATE/unhealthy"
pass "a rollback that fails its health check returns to the running release"

exec 8>"$STATE/deploy.lock"
flock -n 8 || fail "could not hold the deploy lock"
mark
expect_failure "concurrent deploy" "Another deploy or rollback is running" deploy_sh
expect_failure "concurrent rollback" "Another deploy or rollback is running" deploy_sh rollback
if built_or_migrated || grep -q " up -d" "$FAKE_STATE/calls.log"; then fail "a locked-out run changed containers"; fi
exec 8>&-
assert_live "$SHA_C" "lock"
pass "a second deploy or rollback is refused while one holds the lock"

extract_release "$SHA_E" "$M1"
mark
expect_failure "older release on a newer schema" "Refusing to deploy: .*does not know: $M2" deploy_sh
if grep -q "run --rm migrate" "$FAKE_STATE/calls.log"; then fail "migrations ran for a refused deploy"; fi
assert_live "$SHA_C" "older release refused"
pass "deploying a release that does not know an applied migration is refused before migrating"

extract_release "$SHA_C" "$M1" "$M2"
expect_failure "requested SHA differs" "Requested release $SHA_E" deploy_sh deploy "$SHA_E"
printf 'not-a-sha\n' > "$APP/.release-sha"
expect_failure "malformed release SHA" "does not hold a full commit SHA" deploy_sh
rm "$APP/.release-sha"
expect_failure "missing release SHA" "Missing .release-sha" deploy_sh
extract_release "$SHA_C" "$M1"
expect_failure "changed tree for a recorded SHA" "differs from the recorded release" deploy_sh
assert_live "$SHA_C" "identity checks"
pass "release identity: .release-sha required, must match the request and an immutable record"

extract_release "$SHA_C" "$M1" "$M2"
cat "$FAKE_STATE/images/hushle-app@$SHA_C" >> "$FAKE_STATE/unhealthy"
expect_failure "unhealthy redeploy" "no other release to return to" deploy_sh
[[ "$(state current)" == "$SHA_C" && "$(state previous)" == "$SHA_A" ]] || fail "failed redeploy changed the release state"
: > "$FAKE_STATE/unhealthy"
mark
expect_failure "failed migration" "" deploy_with FAKE_MIGRATE_FAIL=1 --
if grep -q " up -d --no-build" "$FAKE_STATE/calls.log"; then fail "containers switched after a failed migration"; fi
assert_live "$SHA_C" "failed migration"
pass "failed redeploy or migration leaves the release state alone"

deploy_sh status > "$TEMP_DIR/status.txt"
grep -q "^current  $SHA_C app=present jobs=present migrate=present" "$TEMP_DIR/status.txt" || { cat "$TEMP_DIR/status.txt" >&2; fail "status"; }
grep -q "^previous $SHA_A app=present" "$TEMP_DIR/status.txt" || fail "status previous"
expect_failure "unknown action" "Usage: deploy.sh" deploy_sh destroy
pass "status lists both releases and their images; unknown actions are refused"

extract_release "$SHA_F" "$M1" "$M2"
expect_failure "container not recreated" "$SHA_C is live again" deploy_with FAKE_UP_KEEPS_CONTAINER=1 --
assert_live "$SHA_C" "container not recreated"
[[ "$(state previous)" == "$SHA_A" ]] || fail "a switch that kept the old container changed the release state"
pass "a switch is only healthy when the app container runs the release image"

echo "release-gate.sh"
GATE="$ROOT_DIR/scripts/ops/release-gate.sh"
cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${*: -1}"
printf '%s\n' "$url" >> "$FAKE_STATE/gate-calls.log"
case "$url" in
  */compare/*)
    [[ "${GATE_COMMIT_EXISTS:-true}" == "true" ]] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
    printf '{"status":"%s"}' "${GATE_COMPARE_STATUS:-behind}"
    ;;
  */actions/workflows/ci.yml/runs*)
    if [[ -n "${GATE_RUNS:-}" ]]; then
      printf '%s' "$GATE_RUNS"
    else
      printf '%s' '{"total_count":0,"workflow_runs":[]}'
    fi
    ;;
  *) exit 22 ;;
esac
EOF
chmod +x "$FAKE_BIN/curl"
GATE_SHA="$(printf 'f%.0s' {1..40})"
good_run() {
  printf '{"total_count":1,"workflow_runs":[{"head_sha":"%s","head_branch":"%s","event":"%s","conclusion":"%s","head_repository":{"full_name":"%s"},"html_url":"https://github.com/acme/hushle/actions/runs/1"}]}' \
    "${1:-$GATE_SHA}" "${2:-main}" "${3:-push}" "${4:-success}" "${5:-acme/hushle}"
}
# gate_for SHA VAR=value...
gate_for() {
  env PATH="$FAKE_BIN:$PATH" GITHUB_REPOSITORY=acme/hushle GITHUB_TOKEN=test-token "${@:2}" bash "$GATE" "$1"
}
gate() { gate_for "$GATE_SHA" "$@"; }
: > "$FAKE_STATE/gate-calls.log"
expect_failure "short SHA" "full 40-character" gate_for abc1234 GATE_RUNS="$(good_run)"
expect_failure "uppercase SHA" "full 40-character" gate_for "$(printf 'F%.0s' {1..40})" GATE_RUNS="$(good_run)"
[[ ! -s "$FAKE_STATE/gate-calls.log" ]] || fail "gate called the API for a malformed SHA"
expect_failure "unknown commit" "was not found" gate GATE_COMMIT_EXISTS=false GATE_RUNS="$(good_run)"
expect_failure "commit not on main" "not part of main \(compare status: diverged\)" gate GATE_COMPARE_STATUS=diverged GATE_RUNS="$(good_run)"
expect_failure "commit ahead of main" "not part of main" gate GATE_COMPARE_STATUS=ahead GATE_RUNS="$(good_run)"
expect_failure "no CI run" "no successful CI push run" gate
expect_failure "failed CI run" "no successful CI push run" gate GATE_RUNS="$(good_run "$GATE_SHA" main push failure)"
expect_failure "pull request run" "no successful CI push run" gate GATE_RUNS="$(good_run "$GATE_SHA" main pull_request)"
expect_failure "run of another SHA" "no successful CI push run" gate GATE_RUNS="$(good_run "$SHA_A")"
expect_failure "run from a fork" "no successful CI push run" gate GATE_RUNS="$(good_run "$GATE_SHA" main push success someone/fork)"
expect_failure "run on another branch" "no successful CI push run" gate GATE_RUNS="$(good_run "$GATE_SHA" develop)"
expect_failure "unreadable API answer" "could not read the CI runs" gate GATE_RUNS="not json"
pass "release gate refuses malformed, unknown, off-main and non-CI-green commits"
gate GATE_RUNS="$(good_run)" | grep -q "Release gate passed: $GATE_SHA is on main" || fail "gate refused a green main commit"
gate GATE_COMPARE_STATUS=identical GATE_RUNS="$(good_run)" | grep -q "Release gate passed" || fail "gate refused main HEAD"
grep -q 'runs?head_sha=f\{40\}&branch=main&event=push&status=success' "$FAKE_STATE/gate-calls.log" || fail "gate did not filter CI runs by SHA, branch and event"
pass "release gate accepts a commit on main with a successful CI push run"

echo "Deploy and rollback checks passed ($PASSED)."
