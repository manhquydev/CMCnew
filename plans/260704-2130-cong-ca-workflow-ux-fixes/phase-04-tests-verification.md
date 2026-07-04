---
phase: 4
title: Tests & verification
status: completed
priority: P1
dependencies:
  - 1
  - 2
  - 3
effort: M
---

# Phase 4: Tests & verification

## Overview

Bổ sung/điều chỉnh test cho hành vi mới + chạy các cổng chất lượng (typecheck, build, int test, permission parity).

## Requirements

- Functional: cover create-lock, future-date guard, updateDates (dọn entries + owner/draft), list include user.
- Non-functional: permission-parity + snapshot khớp; typecheck/build sạch.

## Architecture

Tái dùng pattern int test có sẵn: `apps/api/test/shift-registration-delegated-approver.int.test.ts`, `work-shift-attendance.int.test.ts`, `dashboard-my-approvals.int.test.ts`. E2E công ca: `apps/e2e/tests/work-shift-attendance.spec.ts` (chỉ smoke, không bắt buộc mở rộng vòng này).

## Related Code Files

- Create/Modify: `apps/api/test/shift-registration-workflow.int.test.ts` (hoặc mở rộng file int hiện có)
- Modify: `apps/api/test/fixtures/permission-snapshot.json` (đã thêm ở Phase 1 — verify)
- Verify: `apps/api/test/permission-parity.test.ts` xanh

## Implementation Steps

1. Int test **create-lock**: user có phiếu `draft` → `create` CONFLICT; có `submitted` → CONFLICT; chỉ còn `approved`/`cancelled` → tạo được.
2. Int test **future-date**: `create`/`updateDates`/`submit` với `fromDate = hôm nay` và `< hôm nay` → BAD_REQUEST; `= ngày mai` → OK. (Cố định "hôm nay" theo Asia/Saigon; nếu test dùng fake timer, khớp helper.)
3. Int test **updateDates**: đổi range hẹp lại → entries ngoài range bị xoá, entries trong range giữ; non-owner → FORBIDDEN; phiếu `submitted` → CONFLICT; audit-log ghi nhận.
4. Int test **list include**: phiếu trả kèm `user.displayName`/`user.email`; manager thấy phiếu nhân viên (qua `visibleRegistrationWhere`), user thường chỉ thấy của mình.
5. Chạy: `pnpm --filter @cmc/api test` (int), `pnpm typecheck`, build admin. Sửa hồi quy nếu có.
6. Verify `permission-parity.test.ts` + snapshot có `shiftRegistration.updateDates`.

## Success Criteria

- [ ] Tất cả int test mới xanh; permission-parity xanh.
- [ ] `pnpm typecheck` sạch; build `apps/admin` sạch.
- [ ] Không hồi quy test công ca/attendance hiện có.

## Risk Assessment

- **BLOCKER:** cần `apps/api` khôi phục để chạy test.
- Timezone trong test: nếu CI chạy TZ khác, "hôm nay" phải tính theo Asia/Saigon giống helper — tránh test flaky quanh nửa đêm.
- DB test: int test cần Postgres (advisory-lock, raw counter) — dùng harness int hiện có, không mock.
