#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for migration in infra/postgres/migrations/*.sql; do
  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U postgres -d app -v ON_ERROR_STOP=1 <"$migration"
done
