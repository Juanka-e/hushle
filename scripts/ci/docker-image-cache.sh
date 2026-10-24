#!/usr/bin/env bash
# Makes the Docker images listed on stdin (one reference per line) available
# locally: each one is loaded from <cache-dir> when an archive exists, and
# otherwise pulled with retries and saved there for the next run.
#
# Shared CI runners hit the per-IP limits for anonymous pulls from Docker Hub
# and public.ecr.aws ("toomanyrequests: Data limit exceeded"). CI restores
# <cache-dir> from the Actions cache, so an image is pulled once per reference
# instead of on every run.
#
# DOCKER_IMAGE_MIRRORS optionally lists "<image>=<mirror>" pairs separated by
# spaces: when <image> cannot be pulled, <mirror> is pulled instead and tagged
# as <image>. A mirror must be pinned by digest, so it can only ever be the
# exact image that digest names (for example the publisher's copy of the same
# build on another registry).
#
# Usage: docker-image-cache.sh <cache-dir> < image-list
set -euo pipefail

CACHE_DIR="${1:?Usage: docker-image-cache.sh <cache-dir> < image-list}"
mkdir -p "$CACHE_DIR"

mirror_for() {
  local image="$1" pair
  for pair in ${DOCKER_IMAGE_MIRRORS:-}; do
    if [[ "${pair%%=*}" == "$image" ]]; then
      printf '%s' "${pair#*=}"
      return 0
    fi
  done
}

pull_with_retry() {
  local image="$1" attempt
  for attempt in 1 2 3 4; do
    if docker pull --quiet "$image" >/dev/null; then
      return 0
    fi
    if [[ "$attempt" -lt 4 ]]; then
      echo "Pull of $image failed (attempt $attempt); retrying in $((attempt * 30)) s" >&2
      sleep $((attempt * 30))
    fi
  done
  echo "Could not pull $image" >&2
  return 1
}

pull_image() {
  local image="$1" mirror
  mirror="$(mirror_for "$image")"
  if [[ -z "$mirror" ]]; then
    pull_with_retry "$image"
    return
  fi
  if [[ "$mirror" != *@sha256:* ]]; then
    echo "Mirror $mirror for $image is not pinned by digest" >&2
    return 1
  fi
  if docker pull --quiet "$image" >/dev/null; then
    return 0
  fi
  echo "Pull of $image failed; pulling the same digest from $mirror" >&2
  pull_with_retry "$mirror" || return 1
  docker tag "$(docker image inspect --format '{{.Id}}' "$mirror")" "$image"
}

while IFS= read -r image || [[ -n "$image" ]]; do
  image="${image%$'\r'}"
  [[ -n "$image" ]] || continue
  archive="$CACHE_DIR/$(printf '%s' "$image" | sha256sum | cut -c1-32).tar"
  # An archive keeps tags but not registry digests, so a digest-pinned image is
  # pulled by digest (the registry verifies it), then saved and loaded under its
  # tag. Consumers refer to it by that tag (E2E_IMAGES_PRELOADED in the backup
  # e2e). The cache key covers the full reference, digest included.
  local_ref="$image"
  if [[ "$image" == *@sha256:* ]]; then
    local_ref="${image%@*}"
    [[ "${local_ref##*/}" == *:* ]] || local_ref="$local_ref:latest"
  fi
  if [[ -s "$archive" ]] && docker load --quiet --input "$archive" >/dev/null &&
    docker image inspect "$local_ref" >/dev/null 2>&1; then
    echo "Loaded $local_ref from cache"
    continue
  fi
  pull_image "$image"
  [[ "$local_ref" == "$image" ]] || docker tag "$image" "$local_ref"
  # Caching is an optimisation: an image the engine cannot save is still usable.
  if docker save --output "$archive.partial" "$local_ref"; then
    mv "$archive.partial" "$archive"
    echo "Pulled and cached $image"
  else
    rm -f "$archive.partial"
    echo "Pulled $image; saving it to the cache failed, so the next run pulls it again" >&2
  fi
done
