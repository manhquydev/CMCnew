# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# Single-stage build: pnpm isolated linker creates per-package node_modules/
# with symlinks to the virtual store. Multi-stage COPY of node_modules/ breaks
# these symlinks for workspace packages (apps/api/node_modules/ is missing).
# Single stage avoids the copy entirely — node_modules are created in place.
#
# Layer order: manifests → install → prisma generate → source
# Any source change only invalidates the last COPY layer (not the install).
#
# The cmc_app DB role is created by migration 20260623045316_rls_tenancy;
# run "pnpm --filter @cmc/db migrate" (via DIRECT_URL) before first start.

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app
ENV NODE_ENV=production
# pnpm isolated linker creates apps/api/node_modules/ without .modules.yaml so
# pnpm's script runner can't detect it and skips PATH setup. Preset PATH so
# tsx (and other workspace-package binaries) are found when pnpm runs scripts.
ENV PATH="/app/apps/api/node_modules/.bin:/app/node_modules/.bin:${PATH}"

# ── Manifests first — install layer is cached until any package.json changes ──
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

# Full workspace install so prisma (devDep of @cmc/db) is available
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy Prisma schema and generate client (prisma resolved via @cmc/db context)
COPY packages/db/prisma ./packages/db/prisma
RUN pnpm --filter @cmc/db run generate

# ── Source — only invalidated when code changes, not on dep changes ────────────
COPY packages ./packages
COPY apps/api  ./apps/api

EXPOSE 4000

# CWD becomes /app/apps/api so pnpm picks up the local package.json scripts.
# dotenv in index.ts looks for ../../.env = /app/.env — not present in prod;
# all env vars must come from the container environment (docker-compose).
WORKDIR /app/apps/api
# Use tsx directly — pnpm's isolated linker creates apps/api/node_modules/ without
# .modules.yaml so pnpm's script runner skips PATH setup and can't find tsx.
# Shell form (not exec form) inherits the ENV PATH above so tsx resolves correctly.
CMD tsx src/index.ts
