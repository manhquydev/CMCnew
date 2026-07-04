---
phase: 3
title: Tests & verification
status: completed
priority: P1
dependencies:
  - 1
  - 2
effort: S
---

# Phase 3: Tests & verification

## Overview

Test cấp mã (unique, một-lần, atomic) + backfill, và chạy cổng migrate/typecheck/test.

## Requirements

- Functional: cover cấp mã mới, giữ mã khi update, format đệm 4 số, hiển thị.
- Non-functional: migrate 0-drift dev + prod-mirror.

## Related Code Files

- Create/Modify: `apps/api/test/employee-code.int.test.ts`
- Verify: migration chain `packages/db/prisma/migrations/*`

## Implementation Steps

1. Int test **cấp mã**: `upsertEmploymentProfile` tạo hồ sơ mới → `employeeCode` khớp `^CMC\d{4,}$`; hai hồ sơ liên tiếp → mã liền kề, khác nhau.
2. Int test **một-lần**: update hồ sơ đã có mã → mã không đổi.
3. Int test **atomic**: tạo 2 hồ sơ song song (Promise.all trong tx tách) → 2 mã khác nhau, không trùng.
4. Int/verify **backfill**: seed vài hồ sơ không mã, chạy migration/backfill → mã gán theo `createdAt`, counter = count, rerun không đổi.
5. Int/verify **display**: `shiftRegistration.list` trả `user.employeeCode`; fallback khi thiếu.
6. Chạy: `pnpm --filter @cmc/db migrate` (dev + prod-mirror, `migrate status` 0-drift), `pnpm typecheck`, `pnpm --filter @cmc/api test`.

## Success Criteria

- [ ] Tất cả int test mới xanh.
- [ ] `migrate status` 0-drift trên dev + prod-mirror.
- [ ] `pnpm typecheck` sạch; không hồi quy test payroll/shift hiện có.

## Risk Assessment

- **BLOCKER:** cần `apps/api` khôi phục để chạy hook + test.
- Test atomic cần Postgres thật (INSERT…ON CONFLICT) — dùng harness int, không mock.
- Prod backfill: verify trên prod-mirror, backup trước khi apply prod (hard-gate).
