#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo ./scripts/restore-cloudflared.sh" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${CLOUDFLARE_ENV_FILE:-/home/mrmoe28/.config/codex/secrets/cloudflare-lock28.env}"
account_id="${CLOUDFLARE_ACCOUNT_ID:-e519187d96460cc299dc4f153ed9866d}"
admin_host="${CLOUDFLARE_ADMIN_HOST:-supabase-admin.ekodevops.com}"
gateway_host="${CLOUDFLARE_GATEWAY_HOST:-supabase.ekodevops.com}"
config_dir="/etc/cloudflared"
root_credentials_dir="/root/.cloudflared"

if [[ ! -f "$env_file" ]]; then
  echo "Missing env file: $env_file" >&2
  exit 1
fi

set -a
. "$env_file"
set +a

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set in $env_file}"
: "${CLOUDFLARE_TUNNEL_ID:?CLOUDFLARE_TUNNEL_ID must be set in $env_file}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

token_json="$tmp_dir/token.json"
cred_json="$tmp_dir/${CLOUDFLARE_TUNNEL_ID}.json"
config_yml="$tmp_dir/config.yml"

curl -fsS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${account_id}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/token" \
  -o "$token_json"

python3 - "$token_json" "$cred_json" <<'PY'
import base64
import json
import sys

token_path, out_path = sys.argv[1], sys.argv[2]
with open(token_path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

if not payload.get("success"):
    raise SystemExit(json.dumps(payload))

decoded = base64.b64decode(payload["result"]).decode("utf-8")
short = json.loads(decoded)
long = {
    "AccountTag": short["a"],
    "TunnelID": short["t"],
    "TunnelSecret": short["s"],
}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(long, fh)
    fh.write("\n")
PY

cat > "$config_yml" <<EOF
tunnel: ${CLOUDFLARE_TUNNEL_ID}
credentials-file: ${root_credentials_dir}/${CLOUDFLARE_TUNNEL_ID}.json
protocol: http2
metrics: 127.0.0.1:2000
no-autoupdate: true

ingress:
  - hostname: lock28.com
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
      httpHostHeader: lock28.com
  - hostname: www.lock28.com
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
      httpHostHeader: www.lock28.com
  - hostname: panel.lock28.com
    service: http://localhost:8000
  - hostname: ops.lock28.com
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
      httpHostHeader: ops.lock28.com
  - hostname: ${gateway_host}
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
      httpHostHeader: ${gateway_host}
  - hostname: ${admin_host}
    service: https://localhost:443
    originRequest:
      noTLSVerify: true
      httpHostHeader: ${admin_host}
  - service: http_status:404
EOF

install -d -m 700 "$config_dir" "$root_credentials_dir"
install -m 600 "$cred_json" "${root_credentials_dir}/${CLOUDFLARE_TUNNEL_ID}.json"
install -m 644 "$config_yml" "${config_dir}/config.yml"

systemctl restart cloudflared
systemctl --no-pager --full status cloudflared

printf '\nRestored cloudflared config for %s and %s\n' "$gateway_host" "$admin_host"
