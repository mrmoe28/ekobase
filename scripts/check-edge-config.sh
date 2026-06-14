#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${1:-$repo_root/docker-compose.coolify.yml}"

gateway_host='supabase.ekodevops.com'
admin_host='supabase-admin.ekodevops.com'
bad_admin_host='admin.supabase.ekodevops.com'

require_pattern() {
  local pattern="$1"
  local label="$2"
  if ! rg -Fq "$pattern" "$compose_file"; then
    printf 'FAIL  missing %s in %s\n' "$label" "$compose_file" >&2
    return 1
  fi
  printf 'OK    found %s\n' "$label"
}

forbid_pattern() {
  local pattern="$1"
  local label="$2"
  if rg -Fq "$pattern" "$compose_file"; then
    printf 'FAIL  found forbidden %s in %s\n' "$label" "$compose_file" >&2
    return 1
  fi
  printf 'OK    no forbidden %s\n' "$label"
}

require_pattern "Host(\`${gateway_host}\`)" "gateway host ${gateway_host}"
require_pattern "Host(\`${admin_host}\`)" "admin host ${admin_host}"
forbid_pattern "Host(\`${bad_admin_host}\`)" "legacy admin host ${bad_admin_host}"
