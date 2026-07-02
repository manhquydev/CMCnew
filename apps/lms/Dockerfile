# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# LMS app — served by nginx at the /lms/ sub-path.
# vite build --base=/lms/ ensures asset URLs are prefixed so the outer
# nginx reverse proxy can route them to this container correctly.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/lms/package.json                   apps/lms/
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
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cmc/lms...

COPY tsconfig.base.json ./
COPY packages  ./packages
COPY apps/lms  ./apps/lms

ARG VITE_API_URL=/api
ARG VITE_BASE_URL=/lms/
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm --filter @cmc/lms run build --base=${VITE_BASE_URL}

# ── Nginx runner ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner
COPY --from=build /app/apps/lms/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
