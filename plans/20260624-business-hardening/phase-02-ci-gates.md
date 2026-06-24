# Phase 02 — Siết CI: thêm test + lint vào gate (P0)

> 112 domain-test + 9 integration-test + lint hiện KHÔNG gác merge. Gắn vào CI để invariant không vỡ âm thầm.

## Context
- CI hiện tại: `.github/workflows/ci.yml` chạy install → prisma generate → migrate → seed → verify-rls → typecheck → build. **Thiếu:** `pnpm -r test`, `pnpm -r lint`, và integration test.
- Postgres service đã có sẵn trong workflow → integration test tái dùng được, không thêm hạ tầng.

## Files
- SỬA `.github/workflows/ci.yml`
- KIỂM TRA `package.json` root có script `lint`, `test` (đã có: `turbo run lint/test`); thêm `test:int` nếu cần ở `apps/api`.

## Steps
1. Sau bước `Verify RLS isolation`, thêm step `Domain + integration tests`: `pnpm -r test` rồi `pnpm --filter @cmc/api test:int` (DB đã migrate+seed ở bước trên).
2. Thêm step `Lint`: `pnpm -r lint` (xác minh mỗi package có script lint; nếu thiếu, bổ sung eslint tối thiểu — không nới lỏng rule sẵn có).
3. Đặt thứ tự để fail sớm: lint + typecheck trước build; test sau seed.
4. (Tùy chọn) tách job `quality` (lint/typecheck/test) và `build` để đọc log rõ hơn.

## Tests / Validation (done-evidence)
- [ ] Mở 1 PR thử phá 1 invariant → CI **đỏ** ở đúng step test.
- [ ] PR sạch → CI **xanh** với đủ step: migrate, seed, verify-rls, lint, typecheck, **test**, **test:int**, build.
- [ ] Dán link/log CI xanh vào reports/.

## Rủi ro
- Integration test bất ổn (flaky) do DB chung trong CI → đảm bảo seed cô lập + chạy tuần tự (kế thừa từ Phase 01).
- Lint có thể lộ nợ sẵn có → ghi nhận, sửa hoặc khoanh vùng có chủ đích, **không** tắt rule để cho qua.
