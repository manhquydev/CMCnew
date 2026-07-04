---
phase: 3
title: Frontend list panel
status: completed
priority: P2
dependencies:
  - 1
effort: S
---

# Phase 3: Frontend list panel

## Overview

Sửa `shift-reg-list-panel.tsx`: ẩn/disable nút "Tạo phiếu" khi user còn phiếu chưa hoàn tất (A1), thêm cột "Nhân sự" cho người xem nhiều phiếu (A4).

## Requirements

- Functional: nút "Tạo phiếu" chỉ bật khi user không còn phiếu `draft`/`submitted` của chính mình; cột "Nhân sự" (Họ tên · email) hiện khi list trả nhiều chủ phiếu.
- Non-functional: không gọi thêm API thừa (tận dụng `regs` đã tải).

## Architecture

**A1 — chặn tạo phiếu (client, khớp guard backend):** từ `regs` đã tải, tính `hasOpen = regs.some(r => r.userId === me.id && ['draft','submitted'].includes(r.status))`. Nút "Tạo phiếu": khi `hasOpen` → `disabled` + tooltip "Bạn đang có phiếu chưa hoàn tất — mở phiếu Nháp/Chờ duyệt để sửa." Backend vẫn là chốt chặn cuối (Phase 1); client chỉ để UX. Lưu ý: `list` mặc định đã lọc theo `visibleRegistrationWhere` nên với user thường `regs` chính là phiếu của họ.

**A4 — cột Nhân sự:** thêm cột "Nhân sự" hiển thị `r.user?.displayName · r.user?.email` (Plan B: prefix `CMC0001`). Chỉ render cột khi có ích: `showStaff = me.isSuperAdmin || me.roles.some(r => ['hr','giam_doc_kinh_doanh','giam_doc_dao_tao', ...manager]) ` — hoặc đơn giản: hiện cột khi `regs` chứa ≥1 phiếu có `userId !== me.id`. Chọn cách sau (dữ liệu-driven, KISS): `showStaff = regs.some(r => r.userId !== me.id)`.

## Related Code Files

- Modify: `apps/admin/src/shift-reg-list-panel.tsx`
- (Contract từ Phase 1: `list` trả `user{displayName,email}` + type `ShiftReg` cập nhật tự động qua tRPC inference)

## Implementation Steps

1. Tính `hasOpen`; áp `disabled`+tooltip cho nút "Tạo phiếu" (giữ điều kiện `canCreate` hiện có).
2. Tính `showStaff = regs.some(r => r.userId !== me.id)`; nếu true, chèn cột "Nhân sự" (header + cell) trước hoặc sau cột "Mã phiếu".
3. Cell nhân sự: `Text` Họ tên + `Text` email dimmed; fallback `—` khi thiếu.
4. Kiểm type `ShiftReg` (inferred) đã có `user` sau Phase 1.

## Success Criteria

- [ ] User còn phiếu draft/submitted → nút "Tạo phiếu" disable + tooltip; hết phiếu mở → bật lại.
- [ ] Manager/HR/giám đốc thấy cột "Nhân sự" (tên · email); user thường (chỉ thấy phiếu mình) không thừa cột.
- [ ] Không phát sinh call API thừa.

## Risk Assessment

- `me.id`: xác nhận field id user trong `useSession()` (có thể là `me.userId`) — kiểm trước khi so `r.userId`.
- Nếu `list` chưa trả `user` (Phase 1 chưa xong) thì cột rỗng — Phase 3 phụ thuộc Phase 1, giữ thứ tự.
