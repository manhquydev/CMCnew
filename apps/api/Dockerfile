# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# No separate TypeScript compile step — API is run directly with tsx,
# so the runner stage includes source files and tsx in node_modules.
#
# Prisma client is generated in the runner stage after source is copied.
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
# Install prod + dev deps (tsx is a devDep but needed at runtime)
RUN pnpm install --frozen-lockfile --filter @cmc/api...

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app
ENV NODE_ENV=production

# Hoisted node_modules (includes tsx, prisma, all workspace dep modules)
COPY --from=deps /app/node_modules ./node_modules

# Workspace manifests so pnpm can resolve workspace links when running scripts
COPY package.json pnpm-workspace.yaml ./

# All backend package sources (tsx compiles TypeScript at runtime — no build step)
COPY packages ./packages
COPY apps/api  ./apps/api

# Generate the Prisma client against the engine binary installed by pnpm
RUN node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

EXPOSE 4000

# CWD becomes /app/apps/api so pnpm picks up the local package.json scripts.
# dotenv in index.ts looks for ../../.env = /app/.env — not present in prod;
# all env vars must come from the container environment (docker-compose).
WORKDIR /app/apps/api
CMD ["pnpm", "start"]
