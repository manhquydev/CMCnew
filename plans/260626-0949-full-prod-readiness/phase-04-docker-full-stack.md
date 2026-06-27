---
phase: 4
title: "Docker Full Stack — Dockerfiles + Nginx + docker-compose.prod.yml"
status: pending
priority: P1
dependencies: []
---

# Phase 04: Docker Full Stack

## Overview

Tạo Docker setup cho toàn bộ stack: API (Node.js) + 3 frontend apps (Vite static build) + Nginx reverse proxy.
Mục tiêu: `docker compose -f docker/docker-compose.prod.yml up --build` ra hệ thống hoàn chỉnh.

## Architecture

```
Internet
    │
    ▼
nginx:80/443
    ├── /api/*      → api:4000
    ├── /           → admin-static (port 3000 nội bộ)
    ├── /teaching/* → teaching-static (port 3001 nội bộ)
    └── /lms/*      → lms-static (port 3002 nội bộ)

Services:
  postgres  — data persistence
  redis     — session/cache
  api       — tRPC + SSE server
  admin     — nginx serving Vite build
  teaching  — nginx serving Vite build
  lms       — nginx serving Vite build
  nginx     — reverse proxy
```

## Related Code Files

- Create: `apps/api/Dockerfile`
- Create: `apps/admin/Dockerfile`
- Create: `apps/teaching/Dockerfile`
- Create: `apps/lms/Dockerfile`
- Create: `docker/nginx.conf`
- Create: `docker/docker-compose.prod.yml`
- Create: `.env.production.example`
- Modify: `apps/*/vite.config.ts` nếu cần set base path

## Implementation Steps

### 1. `apps/api/Dockerfile`

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @cmc/api... --prod

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cmc/db generate
RUN pnpm --filter @cmc/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/db/src ./packages/db/src
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

### 2. Frontend Dockerfiles (pattern giống nhau, thay app name)

```dockerfile
# apps/admin/Dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @cmc/admin...
COPY . .
ARG VITE_API_URL=http://localhost/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @cmc/admin build

FROM nginx:alpine AS runner
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`docker/nginx-spa.conf` (SPA fallback):
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(js|css|png|ico|svg)$ { expires 1y; add_header Cache-Control "public"; }
}
```

### 3. `docker/nginx.conf` (reverse proxy)

```nginx
upstream api { server api:4000; }
upstream admin { server admin:80; }
upstream teaching { server teaching:80; }
upstream lms { server lms:80; }

server {
    listen 80;

    location /api/ {
        proxy_pass http://api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE support
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location /teaching/ {
        proxy_pass http://teaching/;
        proxy_set_header Host $host;
    }

    location /lms/ {
        proxy_pass http://lms/;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://admin/;
        proxy_set_header Host $host;
    }
}
```

### 4. `docker/docker-compose.prod.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-cmc}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME:-cmc}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER:-cmc}']
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: postgresql://${DB_USER:-cmc}:${DB_PASSWORD}@postgres:5432/${DB_NAME:-cmc}
      REDIS_URL: redis://redis:6379
      SESSION_SECRET: ${SESSION_SECRET}
      AUTH_COOKIE_NAME: cmc.session
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - '4000:4000'

  admin:
    build:
      context: ..
      dockerfile: apps/admin/Dockerfile
      args:
        VITE_API_URL: /api
    depends_on: [api]

  teaching:
    build:
      context: ..
      dockerfile: apps/teaching/Dockerfile
      args:
        VITE_API_URL: /api

  lms:
    build:
      context: ..
      dockerfile: apps/lms/Dockerfile
      args:
        VITE_API_URL: /api

  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on: [api, admin, teaching, lms]

volumes:
  pgdata:
  redisdata:
```

### 5. `.env.production.example`

```env
DB_USER=cmc
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DB_NAME=cmc
SESSION_SECRET=CHANGE_ME_32_CHAR_RANDOM_STRING
```

### 6. Verify API build target

Check `apps/api/package.json` có `"build"` script không. Nếu chỉ có `"dev"` (tsx watch):
- Cần thêm `"build": "tsc -p tsconfig.json"` + `tsconfig.json` có `outDir: "dist"`
- Hoặc dùng `tsx` thay `node` trong runner stage (đơn giản hơn nhưng nặng hơn)

## Success Criteria

- [ ] `docker compose -f docker/docker-compose.prod.yml up --build` thành công (không lỗi build)
- [ ] `curl http://localhost/api/health` → 200 (cần có health endpoint)
- [ ] `curl http://localhost/` → admin HTML
- [ ] `curl http://localhost/teaching/` → teaching HTML
- [ ] `curl http://localhost/lms/` → lms HTML
- [ ] SSE endpoint `/api/events/staff` không bị nginx buffer (proxy_buffering off)
- [ ] `.env.production.example` có hướng dẫn rõ ràng

## Risk Assessment

- **Cao**: API có thể cần thêm `build` script + `tsconfig` cho production build
- **Trung bình**: Monorepo pnpm workspace install trong Docker cần cẩn thận với `--filter` flags
- **Mitigation**: Test build locally trước: `docker build -f apps/api/Dockerfile .`
- **Vite base path**: Nếu frontend apps không deploy ở root path (`/teaching/`), cần set `base: '/teaching/'` trong `vite.config.ts` của teaching/lms
