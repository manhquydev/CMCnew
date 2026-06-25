# Plan — Đóng 2 lỗ governance/proof (intake #5 + #6)

> Lập: 2026-06-25 09:07 · Nhánh: develop · Lane: normal
> Mục tiêu: biến 27 int-test và 46 model đã có thành **bằng chứng harness thật**, rồi thêm lớp E2E đáp ứng gate "chạy trên URL như người dùng".

## Bối cảnh

Báo cáo scan codebase 09:00 phát hiện 2 lỗ:

| Lỗ | Triệu chứng | Rủi ro |
|---|---|---|
| #5 Harness tracking illusion | TEST_MATRIX rỗng, story backlog rỗng, harness matrix 1 entry không evidence | Roadmap tự khai `✅` không có cơ sở harness; mất khả năng track regression |
| #6 E2E proof missing | 0 E2E test; tất cả proof ở tầng DB; gate "URL-level" chưa đạt | Không phát hiện được UI-break hay auth-flow regression |

CI/CD (Jenkins) tiếp tục defer theo decision 0004/0005.

## Phases (parallel-executable)

| Phase | Tên | Track | Status | Depends on |
|---|---|---|---|---|
| 01 | Populate TEST_MATRIX + Story backlog | A | pending | — |
| 02 | Playwright E2E smoke tests | B | pending | — |
| 03 | Harness story registration + roadmap update | — | pending | 01, 02 |

Phase 01 và 02 chạy song song. Phase 03 chạy sau cả hai.

## Acceptance Criteria

- [ ] `docs/TEST_MATRIX.md` có ≥27 dòng contract mapping từ int-test thật (1 row/file), không blank
- [ ] `docs/stories/backlog.md` có story entries cho từng cluster hành vi đã build
- [ ] `harness-cli story add` đã ghi ≥8 story record với `--contract` và `--verify` command
- [ ] `apps/e2e/` tồn tại, Playwright configured, `pnpm test:e2e` chạy được locally
- [ ] ≥3 smoke E2E tests PASS: login admin, login lms (student), login teaching
- [ ] `docs/roadmap.md` done-gates cập nhật: `done-by-evidence` = int-test + harness record (không còn self-reported)

## Files bị ảnh hưởng

### Phase 01
- `docs/TEST_MATRIX.md` — viết lại nội dung
- `docs/stories/backlog.md` — viết lại nội dung
- `scripts/bin/harness-cli.exe` — gọi qua CLI (không sửa)

### Phase 02
- `apps/e2e/` — tạo mới (package.json, playwright.config.ts, tests/)
- `pnpm-workspace.yaml` — thêm `apps/e2e`
- `package.json` (root) — thêm `test:e2e` script
- `turbo.json` — thêm task `test:e2e`

### Phase 03
- `docs/roadmap.md` — cập nhật done-gates
- harness DB — ghi qua `harness-cli story add/update`

## Risks

| Risk | Mitigation |
|---|---|
| Playwright cần browser binary (headless) | `npx playwright install chromium --with-deps` trong phase 02 |
| Auth flow dùng in-memory state, Playwright không thể inject JWT trực tiếp | Dùng form login thật trong test; không fake token |
| Apps chưa có seeded user visible trên UI | Dựa vào seed script đã có (`pnpm db:seed`) |
| E2E cần tất cả 3 dev server chạy | `webServer` config trong playwright.config.ts; hoặc test tuần tự từng app |

## Phase files

- [Phase 01 — TEST_MATRIX + Story backlog](phase-01-test-matrix-stories.md)
- [Phase 02 — Playwright E2E](phase-02-playwright-e2e.md)
- [Phase 03 — Harness registration + roadmap](phase-03-harness-register-roadmap.md)
