# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# No separate TypeScript compile step — API is run directly with tsx,
# so the runner stage includes source files and tsx in node_modules.
#
# Prisma client is generated in the deps stage (prisma CLI is a devDep of
# @cmc/db; adding --filter @cmc/db ensures it's installed alongside api deps).
# The cmc_app DB role is created by migration 20260623045316_rls_tenancy;
# run "pnpm --filter @cmc/db migrate" (via DIRECT_URL) before first start.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app

# ── Install stage — manifests only so layer is cached until deps change ───────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json                   apps/api/
COPY packages/audit/package.json             packages/audit/
COPY packages/auth/package.json              packages/auth/
COPY packages/db/package.json                packages/db/
COPY packages/domain-academic/package.json   packages/domain-academic/
COPY packages/domain-finance/package.json    packages/domain-finance/
COPY packages/domain-grading/package.json    packages/domain-grading/
COPY packages/domain-payroll/package.json    packages/domain-payroll/
COPY packages/domain-rewards/package.json    packages/domain-rewards/
# --filter @cmc/db (no ...) includes devDeps of @cmc/db (prisma CLI + engines)
# --filter @cmc/api... installs api + all transitive workspace prod deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cmc/api... --filter @cmc/db

# Copy schema and generate Prisma client while pnpm store cache is still active.
# Generated output lands in node_modules/@prisma/client and node_modules/.prisma/client.
COPY packages/db/prisma ./packages/db/prisma
RUN node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app
ENV NODE_ENV=production

# node_modules includes tsx, generated Prisma client, and all workspace deps
COPY --from=deps /app/node_modules ./node_modules

# Workspace manifests so pnpm can resolve workspace links when running scripts
COPY package.json pnpm-workspace.yaml ./

# All backend package sources (tsx compiles TypeScript at runtime — no build step)
COPY packages ./packages
COPY apps/api  ./apps/api

EXPOSE 4000

# CWD becomes /app/apps/api so pnpm picks up the local package.json scripts.
# dotenv in index.ts looks for ../../.env = /app/.env — not present in prod;
# all env vars must come from the container environment (docker-compose).
WORKDIR /app/apps/api
CMD ["pnpm", "start"]
