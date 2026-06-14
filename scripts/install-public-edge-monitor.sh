#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo ./scripts/install-public-edge-monitor.sh" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
systemd_dir="${repo_root}/ops/systemd"
service_name="ekobase-public-edge-check.service"
timer_name="ekobase-public-edge-check.timer"

install -m 644 "${systemd_dir}/${service_name}" "/etc/systemd/system/${service_name}"
install -m 644 "${systemd_dir}/${timer_name}" "/etc/systemd/system/${timer_name}"

systemctl daemon-reload
systemctl enable --now "${timer_name}"
systemctl start "${service_name}"

systemctl --no-pager --full status "${service_name}" || true
systemctl --no-pager --full status "${timer_name}"
