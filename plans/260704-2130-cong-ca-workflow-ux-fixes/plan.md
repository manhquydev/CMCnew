---
title: Plan A — Cong ca workflow & UX fixes
description: >-
  Fix shift-registration ticket lifecycle lock, editable draft dates +
  future-date rule, deselect-shift UX, and staff identity on the approver list.
status: completed
priority: P2
branch: develop
tags:
  - shift-registration
  - ux
  - workflow
  - validation
blockedBy: []
blocks: []
created: '2026-07-04T14:40:35.623Z'
createdBy: 'ck:plan'
source: skill
---

# Plan A — Cong ca workflow & UX fixes

## Overview

Sửa 4 lỗi hành vi/UX của luồng đăng ký công ca, không đổi kiến trúc:

1. **A1 — Khoá "1 phiếu xuyên suốt":** chỉ cho tạo phiếu mới khi user không còn phiếu `draft`/`submitted`.
2. **A2 — Sửa ngày phiếu Nháp + chặn ngày quá khứ:** thêm mutation `updateDates`, validate `fromDate > today` (Asia/Saigon) ở `create`/`updateDates`/`submit`, UI sửa ngày khi draft.
3. **A3 — Bỏ chọn ca:** đổi ô chọn-1-ca từ `<Radio>` (không bắn onChange khi đã checked) sang click-toggle.
4. **A4 — Hiện nhân sự trên màn duyệt:** `list` include chủ phiếu; list panel thêm cột "Nhân sự".

Nguồn brainstorm: `plans/reports/brainstorm-260704-2130-cong-ca-workflow-ux-and-employee-code-report.md`.
Plan B (mã nhân sự CMCx) sẽ nâng cấp cột A4 hiển thị `CMC0001` — Plan A ship trước với tên+email.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend workflow & validation](./phase-01-backend-workflow-validation.md) | Completed |
| 2 | [Frontend detail panel](./phase-02-frontend-detail-panel.md) | Completed |
| 3 | [Frontend list panel](./phase-03-frontend-list-panel.md) | Completed |
| 4 | [Tests & verification](./phase-04-tests-verification.md) | Completed |

Thứ tự: Phase 1 (backend, gồm permission mới) → Phase 2 & 3 (frontend, phụ thuộc contract Phase 1) → Phase 4 (test toàn bộ).

## Acceptance Criteria (toàn plan)

- [ ] User đang có phiếu `draft` HOẶC `submitted` → `create` trả CONFLICT và nút "Tạo phiếu" ẩn/disable; phiếu `approved`/`cancelled` không chặn.
- [ ] Sửa được `fromDate`/`toDate` phiếu `draft`; không đặt được ngày ≤ hôm nay ở tạo/sửa/nộp (Asia/Saigon).
- [ ] Thu hẹp range làm entries ngoài range bị xoá trong cùng transaction + ghi audit-log.
- [ ] Click ca lần 2 bỏ chọn ở cả chế độ 1-ca và nhiều-ca.
- [ ] Manager/HR/giám đốc thấy cột "Nhân sự" (Họ tên · email) trên danh sách phiếu; nhân sự thường không thấy phiếu người khác (giữ `visibleRegistrationWhere`).
- [ ] `pnpm typecheck` + build sạch; int tests mới xanh; permission-parity + snapshot cập nhật.

## Dependencies

- **BLOCKER (chung, phải xử lý trước implement):** `apps/api` đang bị xoá khỏi working tree (chưa commit, mọi file `D` trong `git status`). Chạy `git checkout -- apps/api` (hoặc xác nhận restructure có chủ đích) trước khi bắt đầu Phase 1.
- Không có cross-plan `blockedBy`: các plan work-shift trước (`260630-1919`, `260630-2019`, `260704-1034-*`) đã `implemented`/historical, không sở hữu 3 file mục tiêu ở trạng thái active.
- Plan B (`cong-ca-employee-code`, sẽ tạo sau) `blocks` mục hiển thị mã ở A4 — nhưng A4 chạy độc lập với tên+email; ghi quan hệ khi tạo Plan B.

## Bất biến phải giữ (không được phá)

- Advisory-lock + supersede-overlap trong `approve`.
- RLS `withRls(rlsContextOf(...))` mọi query; `visibleRegistrationWhere`/`assertCanAccessRegistration`/`assertAssignedApprover`.
- Permission registry là nguồn chân lý (`packages/auth/src/permissions.ts` + snapshot fixture + parity test).
- Không tự duyệt phiếu của mình; chỉ chủ phiếu thao tác draft.
