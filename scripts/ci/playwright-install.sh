#!/usr/bin/env bash
# Installs the Playwright browsers given as arguments together with the Ubuntu
# packages they need, reusing the package files kept in <deb-cache-dir>.
#
# The browsers come from Playwright's CDN in a few seconds. The slow part on
# shared runners is the ~140 MB of system packages behind --with-deps: the
# runner's Ubuntu mirror has served them at 80-160 kB/s, which turned a
# one-minute step into 15-30 minutes. CI restores <deb-cache-dir> from the
# Actions cache, so apt only downloads packages whose version changed since
# the cache was saved. Afterwards the directory holds the package files of
# exactly the installed versions, ready to be saved again.
#
# Usage: playwright-install.sh <deb-cache-dir> <browser>...
set -euo pipefail

USAGE="Usage: playwright-install.sh <deb-cache-dir> <browser>..."
CACHE_DIR="${1:?$USAGE}"
shift
if [[ $# -eq 0 ]]; then
  echo "$USAGE" >&2
  exit 2
fi
# apt's download directory; the script's own test points it elsewhere.
ARCHIVES="${APT_ARCHIVES_DIR:-/var/cache/apt/archives}"

shopt -s nullglob
mkdir -p "$CACHE_DIR"

restored=("$CACHE_DIR"/*.deb)
if [[ ${#restored[@]} -gt 0 ]]; then
  sudo cp -- "${restored[@]}" "$ARCHIVES/"
fi
echo "Restored ${#restored[@]} cached package file(s)."

npx playwright install-deps "$@"
npx playwright install "$@"

# Only installed versions are kept, so the cache does not grow with every
# Ubuntu update and never carries packages the browsers no longer need.
rm -f -- "$CACHE_DIR"/*.deb
kept=0
for deb in "$ARCHIVES"/*.deb; do
  if ! read -r name arch version < <(dpkg-deb --show --showformat='${Package} ${Architecture} ${Version}\n' "$deb" 2>/dev/null); then
    continue
  fi
  query="$name"
  if [[ "$arch" != all ]]; then
    query="$name:$arch"
  fi
  if [[ "$(dpkg-query --show --showformat='${db:Status-Status} ${Version}' "$query" 2>/dev/null || true)" == "installed $version" ]]; then
    cp -- "$deb" "$CACHE_DIR/"
    kept=$((kept + 1))
  fi
done
echo "Cached $kept package file(s) for the next run."
