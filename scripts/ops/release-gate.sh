#!/usr/bin/env bash
# Allows a manual production deploy only for a commit that is on the release
# branch and has a successful CI push run there. The deploy workflow runs this
# from its own trusted main checkout, before the release archive is built.
set -euo pipefail

SHA="${1:-}"
API_URL="${GITHUB_API_URL:-https://api.github.com}"
BRANCH="${RELEASE_BRANCH:-main}"
WORKFLOW_FILE="${CI_WORKFLOW_FILE:-ci.yml}"

fail() {
  echo "Release gate: $*" >&2
  exit 1
}

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "expected a full 40-character lowercase commit SHA, got '$SHA'."
[[ -n "${GITHUB_REPOSITORY:-}" ]] || fail "GITHUB_REPOSITORY is required."
[[ -n "${GITHUB_TOKEN:-}" ]] || fail "GITHUB_TOKEN is required."
command -v jq >/dev/null || fail "jq is required."

github_api() {
  curl --silent --show-error --fail --location --max-time 30 \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API_URL/repos/$GITHUB_REPOSITORY/$1"
}

# base...head: "behind" or "identical" means the commit is in the branch history.
if ! comparison="$(github_api "compare/$BRANCH...$SHA")"; then
  fail "commit $SHA was not found in $GITHUB_REPOSITORY."
fi
status="$(jq -r '.status // empty' <<<"$comparison" 2>/dev/null)" || fail "could not read the comparison for $SHA."
case "$status" in
  behind | identical) ;;
  *) fail "commit $SHA is not part of $BRANCH (compare status: ${status:-unknown})." ;;
esac

if ! runs="$(github_api "actions/workflows/$WORKFLOW_FILE/runs?head_sha=$SHA&branch=$BRANCH&event=push&status=success&per_page=20")"; then
  fail "could not list CI runs for $SHA."
fi
run_url="$(jq -r --arg sha "$SHA" --arg branch "$BRANCH" --arg repo "$GITHUB_REPOSITORY" '
  [.workflow_runs[]?
    | select(.head_sha == $sha and .head_branch == $branch and .event == "push"
        and .conclusion == "success" and .head_repository.full_name == $repo)
  ][0].html_url // empty' <<<"$runs" 2>/dev/null)" || fail "could not read the CI runs of $SHA."
[[ -n "$run_url" ]] || fail "commit $SHA has no successful CI push run on $BRANCH; refusing to deploy it."

echo "Release gate passed: $SHA is on $BRANCH and CI succeeded ($run_url)."
