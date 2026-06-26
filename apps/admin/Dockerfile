# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# Admin app — served at the nginx catch-all "/" so no --base flag is needed.
# VITE_API_URL is passed as a build arg; the built JS bakes in the value.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS build

# Manifests first: layer is re-used until any package.json / lockfile changes.
# We include all workspace packages because @cmc/ui -> @cmc/api -> backend deps.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json                 apps/admin/
COPY apps/api/package.json                   apps/api/
COPY packages/ui/package.json                packages/ui/
COPY packages/audit/package.json             packages/audit/
COPY packages/auth/package.json              packages/auth/
COPY packages/db/package.json                packages/db/
COPY packages/domain-academic/package.json   packages/domain-academic/
COPY packages/domain-finance/package.json    packages/domain-finance/
COPY packages/domain-grading/package.json    packages/domain-grading/
COPY packages/domain-payroll/package.json    packages/domain-payroll/
COPY packages/domain-rewards/package.json    packages/domain-rewards/
# Skip Prisma client auto-generation — not needed in the frontend build stage.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cmc/admin...

# All source files (packages/ui + apps/admin; api source not needed — only
# "import type" references to @cmc/api are used, which esbuild strips at build time)
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm --filter @cmc/admin run build

# ── Nginx runner ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
