# ─── base: install all workspace deps ────────────────────────────────────────
FROM node:22-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app
# Copy manifest files first so pnpm install is cached independently of source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin-ui/package.json apps/admin-ui/
COPY apps/gateway/package.json apps/gateway/
COPY packages/jwt/package.json packages/jwt/
COPY services/admin/package.json services/admin/
COPY services/functions-runner/package.json services/functions-runner/
COPY services/realtime/package.json services/realtime/
COPY services/storage/package.json services/storage/
RUN pnpm install --frozen-lockfile
# Now copy source (changes here don't bust the install cache)
COPY . .

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
ENV HOSTNAME=0.0.0.0
CMD ["node", ".next/standalone/apps/admin-ui/server.js"]
