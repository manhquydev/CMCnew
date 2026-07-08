---
phase: 5
title: "Director staff-mgmt + overview + cancel confirm"
status: pending
priority: P2
dependencies: [1]
---

# Phase 5: Giám đốc quản lý nhân sự gọn + overview + cancel confirm

## Progress (2026-07-08)
- **5c DONE (`37472f2`):** confirm modal trước khi hủy lớp/buổi (cascade warning + echo lý do) trong
  `teacher-lite-class-control-panel.tsx`.
- **5a PENDING:** staff-mgmt-lite (giám đốc quản lý đội GV, CHỈ role `giao_vien` — validate chốt RT-5).
- **5b PENDING:** /overview 2 stat thật ("Bài chờ chấm", "Nhận xét chờ chốt").

## Overview

Ba mảnh hoàn thiện: (a) màn quản lý đội giáo viên BẢN GỌN cho giám đốc trong teacher-lite (không
payroll/KPI); (b) /overview stat thật; (c) modal xác nhận cancel lớp/buổi.

## Requirements
- Functional (a): giám đốc xem danh sách GV cơ sở, thêm GV mới, sửa thông tin cơ bản, phân công lớp.
  KHÔNG lương/KPI/chấm công.
- Functional (b): /overview 2 stat "Bài chờ chấm" + "Nhận xét chờ chốt" query số thật.
- Functional (c): cancel lớp/buổi hiện modal confirm với cascade count trước khi thực thi.

## Architecture
- (a) Staff-mgmt lite: reuse backend user/staff router (`user.*` list/create/update) nhưng UI GỌN riêng
  cho teacher surface. Section mới `staff-lite` trong TEACHER_SURFACE_SECTIONS (Phase 1 đã chừa chỗ) +
  panel `apps/admin/src/teacher-staff-lite-panel.tsx` (mới). Gate = giám đốc. Reuse permission user.*.
- (b) Overview stats: `apps/admin/src/teacher-today-panel.tsx` — thay 2 StatCard hardcode bằng query.
  Tìm API đếm: submission chờ chấm (submission.listByExercise/pending), evidence draft chưa publish.
  Có thể thêm `dashboard.*` count hoặc reuse existing.
- (c) Confirm modal: `apps/admin/src/teacher-lite-class-control-panel.tsx` — bọc handler cancelClass/
  cancelSession bằng Mantine `modals.openConfirmModal` show cascade count (số buổi/PH sẽ bị hủy).

## Related Code Files
- Create: `apps/admin/src/teacher-staff-lite-panel.tsx`
- Modify: `apps/admin/src/app-surface.ts` (+staff-lite section), `apps/admin/src/shell.tsx` (nav item giám đốc), `apps/admin/src/App.tsx` (case render)
- Modify: `apps/admin/src/teacher-today-panel.tsx` (stat thật)
- Modify: `apps/admin/src/teacher-lite-class-control-panel.tsx` (confirm modal)
- Reuse: `apps/api/src/routers/user.ts` (staff list/create/update), permission `user.*`

## Implementation Steps
1. (c) Confirm modal cancel — nhanh nhất, làm trước; show cascade count từ response preview hoặc query.
2. (b) Overview stats — tìm/thêm count API; thay hardcode "—".
3. (a) Staff-lite panel — list GV cơ sở + thêm/sửa + phân công; gate giám đốc; audit qua user.* (đã có logEvent).
4. Nav: thêm section staff-lite cho giám đốc (không hiện với GV).
5. Typecheck + live verify.

## Success Criteria
- [ ] Cancel lớp/buổi hiện modal confirm + cascade count trước khi hủy.
- [ ] /overview 2 stat hiện số thật.
- [ ] Giám đốc thấy màn quản lý đội GV gọn; thêm/sửa/phân công được; GV không thấy.
- [ ] typecheck 0 lỗi; live verify.

## Risk Assessment
- Rủi ro (a): quản lý nhân sự chạm authz (user.create/update) — dùng lại gate + audit hiện có, không mở quyền mới ngoài giám đốc.
- Rủi ro (b): query count sai facility scope → dùng RLS/facilityId đúng.
- (c) thấp — chỉ UI wrap.
