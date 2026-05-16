#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/.tmp"
mkdir -p "$LOG_DIR"

cleanup() {
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill -TERM "-$GATEWAY_PID" 2>/dev/null || true
  fi

  if [[ -n "${FUNCTIONS_PID:-}" ]]; then
    kill -TERM "-$FUNCTIONS_PID" 2>/dev/null || true
  fi

  if [[ -n "${REALTIME_PID:-}" ]]; then
    kill -TERM "-$REALTIME_PID" 2>/dev/null || true
  fi

  if [[ -n "${STORAGE_PID:-}" ]]; then
    kill -TERM "-$STORAGE_PID" 2>/dev/null || true
  fi

  if [[ -n "${ADMIN_PID:-}" ]]; then
    kill -TERM "-$ADMIN_PID" 2>/dev/null || true
  fi
}

wait_for_url() {
  local url="$1"
  local name="$2"

  for _ in {1..40}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "Timed out waiting for $name at $url" >&2
  return 1
}

trap cleanup EXIT

pnpm infra:up
pnpm db:migrate

setsid pnpm dev:functions >"$LOG_DIR/functions-runner.log" 2>&1 &
FUNCTIONS_PID=$!

setsid pnpm dev:realtime >"$LOG_DIR/realtime.log" 2>&1 &
REALTIME_PID=$!

setsid pnpm dev:storage >"$LOG_DIR/storage.log" 2>&1 &
STORAGE_PID=$!

setsid pnpm dev:admin >"$LOG_DIR/admin.log" 2>&1 &
ADMIN_PID=$!

setsid pnpm dev:gateway >"$LOG_DIR/gateway.log" 2>&1 &
GATEWAY_PID=$!

wait_for_url "http://127.0.0.1:54322/health" "functions runner"
wait_for_url "http://127.0.0.1:54323" "realtime"
wait_for_url "http://127.0.0.1:54324/health" "storage"
wait_for_url "http://127.0.0.1:54325/health" "admin"
wait_for_url "http://127.0.0.1:54321/health" "gateway"

pnpm test:e2e
