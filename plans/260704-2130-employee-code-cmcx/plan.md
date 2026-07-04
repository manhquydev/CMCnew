---
title: Plan B — Ma nhan su CMCx (employee code)
description: >-
  Auto-increment staff code CMC0001.. on EmploymentProfile: schema + counter +
  backfill + generation hook + display on shift-registration list.
status: completed
priority: P2
branch: develop
tags:
  - employee-code
  - hr
  - data-model
  - migration
blockedBy: []
blocks: []
created: '2026-07-04T14:47:46.255Z'
createdBy: 'ck:plan'
source: skill
---

# Plan B — Mã nhân sự CMCx (employee code)

## Overview

Thêm mã nhân sự tự tăng `CMC0001, CMC0002…` (đệm 4 số, chỉ nhân sự) neo trên `EmploymentProfile`:

1. **Schema + migration + backfill:** cột `employeeCode @unique` + bảng đếm global 1-dòng; backfill hồ sơ hiện có theo `createdAt`.
2. **Sinh mã + hiển thị:** cấp mã tại `payroll.upsertEmploymentProfile`; hiện `CMC0001 · Họ tên · email` trên danh sách phiếu công ca (nâng cấp cột A4 của Plan A).
3. **Tests & verification.**

Quyết định người dùng: **chỉ nhân sự** (người có `EmploymentProfile`), định dạng **CMC + đệm 4 số**, tăng **global theo thứ tự tạo hồ sơ**.
Nguồn brainstorm: `plans/reports/brainstorm-260704-2130-cong-ca-workflow-ux-and-employee-code-report.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema migration & backfill](./phase-01-schema-migration-backfill.md) | Completed |
| 2 | [Code generation & display](./phase-02-code-generation-display.md) | Completed |
| 3 | [Tests & verification](./phase-03-tests-verification.md) | Completed |

## Acceptance Criteria (toàn plan)

- [ ] Hồ sơ nhân sự mới được cấp `employeeCode` = `CMC` + số tăng đệm 4 (CMC0001…); không trùng.
- [ ] Backfill: mọi `EmploymentProfile` hiện có được gán mã theo `createdAt ASC`, counter = max; idempotent (chỉ gán khi NULL).
- [ ] Mã KHÔNG đổi khi update hồ sơ (chỉ cấp một lần).
- [ ] Danh sách phiếu công ca hiện `CMC0001 · Họ tên · email` cho người xem nhiều phiếu.
- [ ] `pnpm --filter @cmc/db migrate` chạy sạch trên dev + prod-mirror; int test xanh.

## Dependencies

- **BLOCKER (chung):** `apps/api` bị xoá khỏi working tree — `git checkout -- apps/api` trước khi implement (hook sinh mã ở `payroll.ts`).
- **Quan hệ mềm với Plan A** (`260704-2130-cong-ca-workflow-ux-fixes`, KHÔNG phải hard-block): Plan A hiển thị tên+email độc lập, ship trước được. Plan B chỉ nâng cấp cột đó thêm mã. Nếu Plan A đã ship, Phase 2 Plan B chỉ chỉnh render + mở rộng batch-map resolve mã. Vì không chặn nhau nên `blocks/blockedBy` để trống.
- Hard-gate data model (schema + migration + backfill) → BẮT BUỘC red-team + validate + chạy thử trên prod-mirror trước prod.

## Bất biến phải giữ

- Pattern counter theo `ShiftCodeCounter`/`ReceiptCodeCounter` (raw `INSERT…ON CONFLICT…RETURNING`), không tự chế cơ chế mới.
- Chuỗi migration Prisma tuyến tính, không sửa migration cũ (xem journals work-shift migration).
- RLS + `withRls` cho mọi query đọc `employment_profile`/`app_user`.
