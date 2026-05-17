# ─── base: install all workspace deps ────────────────────────────────────────
FROM node:22-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# ─── backend services (all share the same image) ─────────────────────────────
FROM base AS gateway
EXPOSE 54321
CMD ["node", "--experimental-strip-types", "apps/gateway/src/index.ts"]

FROM base AS admin-service
EXPOSE 54325
CMD ["node", "--experimental-strip-types", "services/admin/src/index.ts"]

FROM base AS functions-runner
EXPOSE 54322
CMD ["node", "--experimental-strip-types", "services/functions-runner/src/index.ts"]

FROM base AS realtime
EXPOSE 54323
CMD ["node", "--experimental-strip-types", "services/realtime/src/index.ts"]

FROM base AS storage
EXPOSE 54324
CMD ["node", "--experimental-strip-types", "services/storage/src/index.ts"]

# ─── admin-ui: build then run ─────────────────────────────────────────────────
FROM base AS admin-ui
RUN pnpm --filter @local/admin-ui build
WORKDIR /app/apps/admin-ui
EXPOSE 3000
ENV PORT=3000
CMD ["node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
