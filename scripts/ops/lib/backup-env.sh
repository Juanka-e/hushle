#!/usr/bin/env bash

read_backup_env_value() {
  local key="$1"
  local default_value="${2:-}"
  local current_value="${!key-}"

  if [[ -n "$current_value" ]]; then
    printf '%s' "$current_value"
    return
  fi

  if [[ -f "$ENV_FILE" ]]; then
    local line
    line="$(grep -m 1 -E "^${key}=" "$ENV_FILE" || true)"
    if [[ -n "$line" ]]; then
      local value="${line#*=}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf '%s' "$value"
      return
    fi
  fi

  printf '%s' "$default_value"
}

require_backup_env_value() {
  local key="$1"
  local value
  value="$(read_backup_env_value "$key")"
  if [[ -z "$value" ]]; then
    echo "Missing required backup setting: $key" >&2
    exit 1
  fi
  printf '%s' "$value"
}
