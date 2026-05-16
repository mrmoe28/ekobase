# ─── base: pnpm + workspace deps ──────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/jwt/package.json packages/jwt/
COPY apps/gateway/package.json apps/gateway/
COPY apps/admin-ui/package.json apps/admin-ui/
COPY services/admin/package.json services/admin/
COPY services/functions-runner/package.json services/functions-runner/
COPY services/realtime/package.json services/realtime/
COPY services/storage/package.json services/storage/
RUN pnpm install --frozen-lockfile

# ─── backend: shared layer for all TS services ────────────────────────────────
FROM base AS backend
COPY packages/ packages/
COPY apps/gateway/ apps/gateway/
COPY services/ services/
COPY examples/ examples/

# ─── per-service targets ──────────────────────────────────────────────────────
FROM backend AS gateway
EXPOSE 54321
CMD ["node", "--experimental-strip-types", "apps/gateway/src/index.ts"]

FROM backend AS admin-service
EXPOSE 54325
CMD ["node", "--experimental-strip-types", "services/admin/src/index.ts"]

FROM backend AS functions-runner
EXPOSE 54322
CMD ["node", "--experimental-strip-types", "services/functions-runner/src/index.ts"]

FROM backend AS realtime
EXPOSE 54323
CMD ["node", "--experimental-strip-types", "services/realtime/src/index.ts"]

FROM backend AS storage
EXPOSE 54324
CMD ["node", "--experimental-strip-types", "services/storage/src/index.ts"]

# ─── admin-ui: build ──────────────────────────────────────────────────────────
FROM base AS admin-ui-builder
COPY packages/ packages/
COPY apps/admin-ui/ apps/admin-ui/
RUN pnpm --filter @local/admin-ui build

# ─── admin-ui: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS admin-ui
WORKDIR /app/apps/admin-ui
COPY --from=admin-ui-builder /app /app
EXPOSE 3000
ENV PORT=3000
CMD ["../../node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
