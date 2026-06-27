---
phase: 6
title: "Final Verify — typecheck + lint + build + e2e + Docker smoke"
status: pending
priority: P1
dependencies: [1, 2, 3, 4, 5]
---

# Phase 06: Final Verify

## Overview

Gate cuối trước khi coi là prod-ready. Không viết code mới — chỉ chạy kiểm tra và fix regressions.

## Verification Sequence

### Step 1: Typecheck toàn monorepo

```powershell
cd D:\project\CMCnew
pnpm -r typecheck
```

Expected: 14/14 packages xanh. Fix bất kỳ lỗi nào trước khi tiếp tục.

### Step 2: Lint

```powershell
pnpm lint
```

Expected: 0 errors (warnings OK). Fix lint errors — không dùng `// eslint-disable`.

### Step 3: Unit tests

```powershell
pnpm test
```

Expected: 129/129 pass (không có regression từ các thay đổi phase 01–05).

Nếu test fail: tìm nguyên nhân trước khi fix — không comment out test.

### Step 4: Build 4 apps

```powershell
pnpm build
```

Expected: 4/4 apps build OK. Chunk size warning = pre-existing, không phải issue mới.

### Step 5: E2E smoke

```powershell
pnpm test:e2e
```

Expected: 9/9 tests pass. Các test bao gồm:
- Admin login → dashboard load
- Teaching login → class list
- LMS PH login → student view
- LMS HS login → view

Nếu e2e fail vì selector thay đổi (do redesign): update selector, không skip test.

### Step 6: Docker build smoke

```powershell
# Build từng image riêng trước
docker build -f apps/api/Dockerfile . --no-cache -t cmc-api:test
docker build -f apps/admin/Dockerfile . -t cmc-admin:test
docker build -f apps/teaching/Dockerfile . -t cmc-teaching:test
docker build -f apps/lms/Dockerfile . -t cmc-lms:test

# Full stack
docker compose -f docker/docker-compose.prod.yml up --build -d
Start-Sleep 15

# Smoke test
curl http://localhost/api/health        # expect 200
curl http://localhost/                  # expect HTML
curl http://localhost/teaching/         # expect HTML
curl http://localhost/lms/              # expect HTML

docker compose -f docker/docker-compose.prod.yml down
```

### Step 7: Browser verify (Chrome DevTools MCP)

Sau khi tất cả automated pass, chụp screenshot để confirm visual:
- Admin: bell badge khi có unread
- Admin HR: staff table hiển thị
- Teaching: "CMC" text ở topbar
- Teaching: class list paginated (20 lớp)
- LMS: student view sau login

## Fix Protocol

Nếu có lỗi ở bất kỳ step nào:
1. Fix root cause, không mask
2. Re-run step đó
3. Nếu fix phase 05/earlier: re-run toàn bộ từ typecheck

## Harness Update

Sau khi verify xanh, update harness với stories mới:
```powershell
.\scripts\bin\harness-cli.exe story add --id BELL-NOTIF --title "Staff bell notification wired" --status implemented --evidence "Phase 01 done, screenshots verified"
.\scripts\bin\harness-cli.exe story add --id HR-PANEL-TABLE --title "HR panel staff table + drawer" --status implemented
.\scripts\bin\harness-cli.exe story add --id DOCKER-PROD --title "Docker full stack prod-ready" --status implemented
```

## Commit Convention

```
feat(ui): wire staff bell notification in admin+teaching shells
feat(admin): hr panel staff table + payslip detail drawer  
fix(teaching): logo consistency + class list pagination
feat(docker): full stack production Dockerfile + docker-compose.prod.yml
refactor(ui): design token sweep — table headers, badges, cards
```

## Success Criteria

- [ ] pnpm -r typecheck: 0 errors
- [ ] pnpm lint: 0 errors  
- [ ] pnpm test: 129+ pass (không giảm)
- [ ] pnpm build: 4/4 apps xanh
- [ ] pnpm test:e2e: 9/9 pass
- [ ] docker compose prod up: tất cả containers healthy
- [ ] curl http://localhost/api/health: 200
- [ ] Screenshots confirm bell, HR table, CMC logo, pagination

## Definition of Done

Khi phase 06 xanh hoàn toàn → tạo PR vào `main` với title:
`feat: full prod readiness — bell notification + HR panel + Docker + design sweep`
