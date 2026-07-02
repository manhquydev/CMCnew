# Phase 4 — GĐ Đào Tạo: Executive Cockpit

## Context links
Parent: `plan.md`. Phụ thuộc **Phase 1** (`dashboard.myApprovals`). Song song được với Phase 3
(file khác nhau, cùng phụ thuộc Phase 1). Pattern giống Phase 3 — xem đó để tránh lặp rationale.

## Overview
- Priority: P2 | Status: done (blocked by Phase 1)
- Nav hiện tại của `giam_doc_dao_tao` (scout mục A): `schedule, attendance, grading, assessment,
  classes, courses, meetings, levelup, guardians, kpi, my-payslips, checkin, shift-registration,
  overview, org`.

## Requirements
- `SectionKey` mới: `edu-director-cockpit`, placeholder gate `{kind:'open'}` (như Phase 3).
- Flag mới: `isEduDirectorOnly = roles.length === 1 && roles[0] === 'giam_doc_dao_tao'`.
- Ẩn khi `isEduDirectorOnly`: `overview` → thay cockpit. Giữ nguyên `attendance/grading/
  assessment/classes/courses/meetings/levelup/guardians/kpi` — giám đốc vẫn cần vào chi tiết học
  vụ, cockpit chỉ là tổng quan + lối tắt duyệt.
- Cockpit hiển thị:
  1. Widget sức khỏe học vụ — **cần mới** vì `dashboard.summary` hiện không có số liệu học vụ
     (chỉ revenue/pipeline/students-active/classes-open, `dashboard.ts:11-24`). Phạm vi tối
     thiểu: tái dùng `levelProgress.listPending` count + `classesOpen` đã có sẵn trong
     `dashboard.summary` — KHÔNG tạo thêm procedure mới ngoài `myApprovals` (giữ YAGNI, đã đủ
     tín hiệu từ 2 nguồn có sẵn).
  2. Hộp duyệt từ `dashboard.myApprovals` (Phase 1): level-progress-pending, shift-reg(DAO_TAO)-
     pending, kpi-pending, manual-punch-pending — nút hành động gọi mutation có sẵn
     (`levelProgress.decide`, `shiftRegistration.approve`, `kpiEvalConfirm`/`kpiEvalApprove`,
     `checkInOut.approveManual`).
- Đây chính là nơi tính năng **climb-session-lock** (plan riêng, đang DRAFT chờ trả lời 3 câu hỏi
  nghiệp vụ — `plans/260701-1223-lms-climb-session-lock/`) sẽ hiển thị tự nhiên nếu triển khai
  sau: tiến độ mở bài theo buổi = 1 widget sức khỏe lớp bổ sung. **KHÔNG** đưa vào phạm vi phase
  này (climb-lock chưa được duyệt code).

## Architecture
Component mới `apps/admin/src/edu-director-cockpit-panel.tsx` — compose `dashboard.summary`
(subset học vụ) + `dashboard.myApprovals`, không mutation logic riêng.

## Related code files
- `apps/admin/src/shell.tsx` (`buildNavGroups`, `SECTION_TITLES`, flag mới)
- `apps/admin/src/nav-permissions.ts` (placeholder gate mới)
- `apps/admin/src/App.tsx` (dispatch case + import)
- `apps/admin/src/edu-director-cockpit-panel.tsx` (mới)

## Implementation Steps
1. Xác nhận Phase 1 xong.
2. Thêm `NAV_GATES.edu-director-cockpit = {kind:'open'}`.
3. Thêm flag `isEduDirectorOnly`, section mới `visible: isEduDirectorOnly`, `overview` đổi
   `visible: !isEduDirectorOnly && visible('overview')`.
4. `SECTION_TITLES` thêm entry.
5. Viết `EduDirectorCockpitPanel`.
6. `App.tsx` dispatch case + import.

## Todo list
- [x] Phase 1 xong (dependency check)
- [x] `NAV_GATES` placeholder mới
- [x] `isEduDirectorOnly` flag + nav visibility logic
- [x] `SECTION_TITLES` entry
- [x] `EduDirectorCockpitPanel` component
- [x] `App.tsx` dispatch case
- [x] Multi-role account verify KHÔNG bị gộp nav

## Success Criteria
Account chỉ có role `giam_doc_dao_tao` → thấy cockpit thay `overview`. Multi-role account →
nav gốc không đổi.

## Risk Assessment
Thấp, giống Phase 3.

## Next steps
Phase 5 viết test `nav-director-dt-cockpit-consolidation.test.ts`.
