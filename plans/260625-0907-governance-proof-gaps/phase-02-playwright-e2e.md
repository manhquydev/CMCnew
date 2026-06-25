---
phase: 2
title: "Playwright E2E smoke tests"
status: pending
priority: P1
dependencies: []
---

# Phase 02: Playwright E2E smoke tests

## Overview

Tạo `apps/e2e/` package với Playwright, viết ≥3 smoke tests kiểm tra login flow và landing page cho admin, lms (student), và teaching app. Đây là lớp proof duy nhất đạt gate "chạy trên URL như người dùng".

## Requirements

- Functional:
  - Smoke test login thành công cho admin app (super_admin credentials)
  - Smoke test login thành công cho lms app (student hoặc parent account)
  - Smoke test login thành công cho teaching app (teacher/staff)
  - Mỗi test verify: trang landing sau login không phải error page (HTTP 200, có element đặc trưng)
- Non-functional:
  - `pnpm test:e2e` chạy từ root (hoặc `pnpm --filter @cmc/e2e test`)
  - Playwright dùng `headless: true` để chạy không cần display
  - Tests chạy tuần tự (không parallel) để tránh port conflict
  - Timeout: 30s per test (phù hợp với dev server cold start)
  - Không dùng `page.waitForTimeout` — dùng `page.waitForSelector` hoặc `page.waitForURL`

## Architecture

```
apps/e2e/
  package.json          # @cmc/e2e, devDep: @playwright/test
  playwright.config.ts  # webServer configs cho 3 app + api
  tests/
    admin-smoke.spec.ts   # login → admin landing
    lms-smoke.spec.ts     # login → lms student view
    teaching-smoke.spec.ts # login → teaching landing
  .gitignore            # /test-results/ /playwright-report/
```

**Auth flow (từ scan `apps/admin/src/App.tsx`):**
- Admin/Teaching: form với email + password → POST qua tRPC `auth.login` → JWT in React state
- LMS: form với email + password → POST qua tRPC `lms-auth.loginParent` hoặc `loginStudent` → JWT in state

**Port map (verified từ vite.config.ts + apps/api/src/index.ts):**
- `apps/api`: port **4000** (`API_PORT` env, default 4000)
- `apps/admin`: port **5173**
- `apps/teaching`: port **5174**
- `apps/lms`: port **5175**

**Auth mechanism (verified từ packages/ui/src/client.ts + packages/auth):**
- Tất cả 3 app dùng **HttpOnly cookie** — server set qua `hono/cookie setCookie()`, client fetch với `credentials: 'include'`
- Staff JWT cookie: `COOKIE_NAME` (admin + teaching dùng chung)
- LMS cookie: `LMS_COOKIE_NAME` (parent + student)
- **Không thể inject token bằng `page.evaluate(localStorage.setItem)`** — phải điền form thật
- Smoke tests dùng UI login flow trực tiếp (đơn giản nhất, đủ cho smoke)

## Related Code Files

- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/tests/admin-smoke.spec.ts`
- Create: `apps/e2e/tests/lms-smoke.spec.ts`
- Create: `apps/e2e/tests/teaching-smoke.spec.ts`
- Create: `apps/e2e/.gitignore`
- Modify: `pnpm-workspace.yaml` — thêm `apps/e2e`
- Modify: `package.json` (root) — thêm `"test:e2e": "pnpm --filter @cmc/e2e test"`
- Modify: `turbo.json` — thêm task `test:e2e` (outputs: test-results/)
- Read: `apps/admin/src/App.tsx` — xác định login form selector
- Read: `apps/lms/src/App.tsx` — xác định login form selector
- Read: `apps/teaching/src/App.tsx` — xác định login form selector
- Read: `apps/*/vite.config.ts` — xác định port

## Implementation Steps

### Bước 1: Verify auth form selectors

Đọc App.tsx của 3 app, tìm:
- Input email/password selectors (Mantine dùng `data-testid` hay label?)
- Submit button text
- Landing element sau login (text hoặc role đặc trưng)

Mantine v7 form inputs: `<TextInput label="Email" ...>` → selector `input[type="email"]` hoặc `getByLabel("Email")`.

### Bước 2: Verify ports

```bash
find apps -name "vite.config.ts" | xargs grep -l "port\|server" 2>/dev/null
```

Nếu không có vite.config.ts với port → dùng Vite defaults (5173 cho app đầu tiên).
Với multiple apps, cần set explicit port để tránh conflict:
- admin: 5173
- lms: 5174
- teaching: 5175

### Bước 3: Install Playwright

```bash
pnpm add -D @playwright/test --filter @cmc/e2e
npx playwright install chromium
```

### Bước 4: Tạo playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,        // serial để tránh port conflict
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cmc/api dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/admin dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/teaching dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cmc/lms dev',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

### Bước 5: Viết smoke tests

**Pattern chung:**
```typescript
// admin-smoke.spec.ts
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'changeme-dev';

test('admin login smoke', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Điền form (selector từ Bước 1)
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  // Verify landing (không phải login page nữa)
  await expect(page.getByText(/tổng quan|overview|dashboard/i)).toBeVisible({ timeout: 10_000 });
});
```

Credentials từ seed script (không hardcode secret — đọc từ env hoặc dùng seed default).

### Bước 6: Wire vào root

```json
// root package.json — thêm script:
"test:e2e": "pnpm --filter @cmc/e2e test"
```

```json
// turbo.json — thêm task:
"test:e2e": {
  "dependsOn": ["build"],
  "outputs": ["apps/e2e/test-results/**"]
}
```

### Bước 7: Smoke run

```bash
# Cần DB chạy + seeded
pnpm db:up && pnpm db:seed
pnpm test:e2e
```

Ghi lại output: PASS/FAIL cho từng spec.

## Success Criteria

- [ ] `apps/e2e/` tồn tại với package.json và playwright.config.ts
- [ ] `pnpm --filter @cmc/e2e test` không crash khi Playwright không installed browser
- [ ] 3 smoke tests exist: admin, lms, teaching
- [ ] Khi chạy với DB+seed, ít nhất `admin-smoke.spec.ts` PASS (lms/teaching có thể cần điều chỉnh credentials)
- [ ] `apps/e2e` có trong `pnpm-workspace.yaml`

## Risk Assessment

**Risk:** Auth form selectors không khớp (Mantine dùng internal label id).
**Mitigation:** Dùng `getByRole('textbox', { name: /email/i })` thay vì `getByLabel()` cứng; hoặc thêm `data-testid` vào form.

**Risk:** `webServer` timeout khi cold-start Vite+HMR.
**Mitigation:** `reuseExistingServer: true` — nếu dev server đang chạy, dùng luôn. Smoke test không cần HMR.

**Risk:** Seed credentials không khớp với test.
**Mitigation:** Đọc `.env.local` hoặc `apps/api/.env` cho seed email/password; dùng env var `TEST_ADMIN_EMAIL`.

**Risk:** Windows path issues với Playwright browser install.
**Mitigation:** Chạy `npx playwright install chromium` một lần manual; thêm note vào README dev setup.

**Risk:** 4 webServer processes (api + 3 UI) → nặng cho test run.
**Mitigation:** Cân nhắc test từng app riêng biệt với `--project` flag; hoặc start server thủ công trước khi test.
