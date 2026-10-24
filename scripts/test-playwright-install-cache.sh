#!/usr/bin/env bash
# Package-file reuse of scripts/ci/playwright-install.sh against stubbed sudo,
# npx and dpkg. The npx stub plays apt: it installs the packages listed in
# $FAKE_STATE/candidates, reuses a matching file from the archive directory
# and "downloads" (creates) the rest, logging which one happened.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/playwright-install.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

FAKE_BIN="$TEMP_DIR/bin"
export FAKE_STATE="$TEMP_DIR/fake"
CACHE="$TEMP_DIR/cache"
PASSED=0
mkdir -p "$FAKE_BIN" "$FAKE_STATE"

cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat > "$FAKE_BIN/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_STATE/calls.log"
[[ "$1" == playwright ]] || exit 1
case "$2" in
  install-deps)
    [[ ! -f "$FAKE_STATE/fail-deps" ]] || { echo "E: Failed to fetch" >&2; exit 100; }
    while read -r name arch version; do
      # apt writes the epoch colon of a version as %3a in file names.
      deb="$APT_ARCHIVES_DIR/${name}_${version//:/%3a}_${arch}.deb"
      if [[ -f "$deb" ]]; then
        echo "reuse $name" >> "$FAKE_STATE/apt.log"
      else
        printf '%s %s %s\n' "$name" "$arch" "$version" > "$deb"
        echo "download $name" >> "$FAKE_STATE/apt.log"
      fi
      key="$name"
      [[ "$arch" == all ]] || key="$name@$arch"
      echo "installed $version" > "$FAKE_STATE/dpkg/$key"
    done < "$FAKE_STATE/candidates"
    ;;
  install) ;;
  *) exit 1 ;;
esac
EOF
cat > "$FAKE_BIN/dpkg-deb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
deb="${@: -1}"
[[ -s "$deb" && "$(head -c 4 "$deb")" != "junk" ]] || { echo "dpkg-deb: error: not a Debian format archive" >&2; exit 2; }
cat "$deb"
EOF
cat > "$FAKE_BIN/dpkg-query" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
query="${@: -1}"
db="$FAKE_STATE/dpkg/${query/:/@}"
[[ -f "$db" ]] || { echo "dpkg-query: no packages found matching $query" >&2; exit 1; }
tr -d '\n' < "$db"
EOF
chmod +x "$FAKE_BIN"/*

pass() {
  PASSED=$((PASSED + 1))
  printf '  ok %d - %s\n' "$PASSED" "$*"
}
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# A fresh runner: empty archive directory and package database. The cache
# directory is whatever the Actions cache restored (kept between runs).
new_runner() {
  rm -rf "$FAKE_STATE/archives" "$FAKE_STATE/dpkg"
  mkdir -p "$FAKE_STATE/archives" "$FAKE_STATE/dpkg"
  : > "$FAKE_STATE/calls.log"
  : > "$FAKE_STATE/apt.log"
  rm -f "$FAKE_STATE/fail-deps"
}
candidates() { printf '%s\n' "$@" > "$FAKE_STATE/candidates"; }
install() {
  PATH="$FAKE_BIN:$PATH" APT_ARCHIVES_DIR="$FAKE_STATE/archives" bash "$SCRIPT" "$CACHE" "$@"
}
cached() { (cd "$CACHE" && ls -1 -- *.deb 2>/dev/null) | sort | tr '\n' ' ' | sed 's/ $//'; }
apt_log() { sort "$FAKE_STATE/apt.log" | tr '\n' ' ' | sed 's/ $//'; }

new_runner
candidates "libgtk-4-1 amd64 4.18.6-1" "fonts-liberation all 1:2.1.5-3" "libwoff1 amd64 1.0.2-3"
output="$(install chromium webkit)"
[[ "$(apt_log)" == "download fonts-liberation download libgtk-4-1 download libwoff1" ]] || fail "first run: $(apt_log)"
[[ "$(cached)" == "fonts-liberation_1%3a2.1.5-3_all.deb libgtk-4-1_4.18.6-1_amd64.deb libwoff1_1.0.2-3_amd64.deb" ]] || fail "first run cache: $(cached)"
grep -q "Restored 0 cached package file(s)." <<< "$output" || fail "first run restore count"
grep -q "Cached 3 package file(s) for the next run." <<< "$output" || fail "first run cached count"
[[ "$(cat "$FAKE_STATE/calls.log")" == $'playwright install-deps chromium webkit\nplaywright install chromium webkit' ]] \
  || fail "browsers were not passed through in order: $(cat "$FAKE_STATE/calls.log")"
pass "an empty cache downloads every package and keeps all installed ones, architecture-independent packages included"

new_runner
output="$(install chromium webkit)"
[[ "$(apt_log)" == "reuse fonts-liberation reuse libgtk-4-1 reuse libwoff1" ]] || fail "second run: $(apt_log)"
grep -q "Restored 3 cached package file(s)." <<< "$output" || fail "second run restore count"
[[ "$(cached)" == "fonts-liberation_1%3a2.1.5-3_all.deb libgtk-4-1_4.18.6-1_amd64.deb libwoff1_1.0.2-3_amd64.deb" ]] || fail "second run cache: $(cached)"
pass "a restored cache on a fresh runner downloads nothing"

new_runner
candidates "libgtk-4-1 amd64 4.18.7-1" "fonts-liberation all 1:2.1.5-3" "libwoff1 amd64 1.0.2-3"
install chromium webkit > /dev/null
[[ "$(apt_log)" == "download libgtk-4-1 reuse fonts-liberation reuse libwoff1" ]] || fail "update run: $(apt_log)"
[[ "$(cached)" == "fonts-liberation_1%3a2.1.5-3_all.deb libgtk-4-1_4.18.7-1_amd64.deb libwoff1_1.0.2-3_amd64.deb" ]] || fail "update run cache: $(cached)"
pass "an Ubuntu update downloads only the changed package and drops its superseded file"

new_runner
candidates "libgtk-4-1 amd64 4.18.7-1" "libwoff1 amd64 1.0.2-3"
printf 'unrelated amd64 2.0\n' > "$FAKE_STATE/archives/unrelated_2.0_amd64.deb"
printf 'removed amd64 1.0\n' > "$FAKE_STATE/archives/removed_1.0_amd64.deb"
echo "config-files 1.0" > "$FAKE_STATE/dpkg/removed@amd64"
printf 'junk' > "$FAKE_STATE/archives/broken_1.0_amd64.deb"
output="$(install chromium)"
[[ "$(cached)" == "libgtk-4-1_4.18.7-1_amd64.deb libwoff1_1.0.2-3_amd64.deb" ]] || fail "pruned cache: $(cached)"
grep -q "Cached 2 package file(s) for the next run." <<< "$output" || fail "pruned cached count"
pass "files of packages no longer needed, removed or unreadable are not cached"

new_runner
printf 'stale\n' > "$CACHE/libwoff1_1.0.2-3_amd64.deb"
cp "$CACHE/libwoff1_1.0.2-3_amd64.deb" "$TEMP_DIR/before.deb"
touch "$FAKE_STATE/fail-deps"
if install chromium > "$TEMP_DIR/out.log" 2>&1; then
  fail "a failed package install was reported as success"
fi
grep -q "E: Failed to fetch" "$TEMP_DIR/out.log" || fail "apt error was not shown"
cmp -s "$CACHE/libwoff1_1.0.2-3_amd64.deb" "$TEMP_DIR/before.deb" || fail "a failed install changed the cache"
grep -q "playwright install chromium" "$FAKE_STATE/calls.log" && fail "browsers were installed after the package install failed"
pass "a failed package install fails the step, skips the browsers and leaves the cache untouched"

new_runner
set +e
PATH="$FAKE_BIN:$PATH" APT_ARCHIVES_DIR="$FAKE_STATE/archives" bash "$SCRIPT" "$CACHE" > "$TEMP_DIR/out.log" 2>&1
no_browsers=$?
PATH="$FAKE_BIN:$PATH" APT_ARCHIVES_DIR="$FAKE_STATE/archives" bash "$SCRIPT" > /dev/null 2>&1
no_args=$?
set -e
[[ "$no_browsers" -eq 2 ]] && grep -q "Usage: playwright-install.sh" "$TEMP_DIR/out.log" || fail "missing browsers exited $no_browsers"
[[ "$no_args" -ne 0 ]] || fail "missing cache directory was accepted"
[[ ! -s "$FAKE_STATE/calls.log" ]] || fail "usage errors still ran playwright"
pass "missing arguments are rejected before anything is installed"

echo "Playwright install cache checks passed ($PASSED)."
