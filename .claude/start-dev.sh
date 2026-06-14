#!/usr/bin/env bash
# Starts all Ekobase dev services in the background if they aren't already running.
set -euo pipefail

PROJECT_DIR="/home/mrmoe28/Project X/Ekobase"
SERVICES_LOG="/tmp/ekobase-services.log"
UI_LOG="/tmp/ekobase-admin-ui.log"

cd "$PROJECT_DIR"

# Check if the gateway is already listening (port 54321 is the gateway default)
if lsof -ti :54321 >/dev/null 2>&1; then
  echo "[ekobase] Services already running — skipping startup"
  exit 0
fi

echo "[ekobase] Starting backend services…"
nohup pnpm dev >> "$SERVICES_LOG" 2>&1 &

echo "[ekobase] Starting admin UI…"
nohup pnpm dev:admin-ui >> "$UI_LOG" 2>&1 &

echo "[ekobase] Services launched. Logs: $SERVICES_LOG  $UI_LOG"
