# syntax=docker/dockerfile:1
# Build context: repo root (set via docker-compose.prod.yml context: ..)
#
# Teaching app — served by nginx at the /teaching/ sub-path.
# vite build --base=/teaching/ ensures asset URLs are prefixed so the outer
# nginx reverse proxy can route them to this container correctly.
#
# Apps use no React Router (state-based routing only), so sub-path serving
# works without a <BrowserRouter basename> change.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/teaching/package.json              apps/teaching/
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
    pnpm install --frozen-lockfile --filter @cmc/teaching...

COPY packages      ./packages
COPY apps/teaching ./apps/teaching

ARG VITE_API_URL=/api
ARG VITE_BASE_URL=/teaching/
ENV VITE_API_URL=${VITE_API_URL}

# pnpm forwards args after "--" to the script command (vite build).
# Result: vite build --base=/teaching/
RUN pnpm --filter @cmc/teaching run build -- --base=${VITE_BASE_URL}

# ── Nginx runner ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS runner
COPY --from=build /app/apps/teaching/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
