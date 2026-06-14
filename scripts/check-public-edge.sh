#!/usr/bin/env bash
set -euo pipefail

admin_url="${ADMIN_URL:-https://supabase-admin.ekodevops.com}"
gateway_url="${GATEWAY_URL:-https://supabase.ekodevops.com}"
gateway_probe_path="${GATEWAY_PROBE_PATH:-/auth/v1/user}"
admin_expected="${ADMIN_EXPECTED_STATUS:-200}"
gateway_expected="${GATEWAY_EXPECTED_STATUS:-401}"

fetch_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "$url"
}

check_status() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local actual

  actual="$(fetch_status "$url")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL  %s %s -> expected %s, got %s\n' "$label" "$url" "$expected" "$actual" >&2
    return 1
  fi

  printf 'OK    %s %s -> %s\n' "$label" "$url" "$actual"
}

check_status "admin" "$admin_url" "$admin_expected"
check_status "gateway" "${gateway_url}${gateway_probe_path}" "$gateway_expected"
