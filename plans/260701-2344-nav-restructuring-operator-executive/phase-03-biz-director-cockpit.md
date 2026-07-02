# Phase 3 — GĐ Kinh Doanh: Executive Cockpit

## Context links
Parent: `plan.md`. Phụ thuộc **Phase 1** (`dashboard.myApprovals`). Pattern tham chiếu:
`isTeacherOnly` trong `apps/admin/src/shell.tsx:372-376,398,435` (teacher-nav plan,
`plans/260701-1910-teacher-nav-lich360-consolidation/`).

## Overview
- Priority: P2 | Status: done (blocked by Phase 1)
- Nav hiện tại của `giam_doc_kinh_doanh` (scout mục A): `schedule, classes, courses, students,
  guardians, crm, cskh, rewards, finance, kpi, my-payslips, checkin, shift-registration,
  overview, org, facility-network`.

## Requirements
- `SectionKey` mới: `biz-director-cockpit`. `NAV_GATES` entry `{kind:'open'}` placeholder
  (giống `student-mgmt`/`payroll-checkin`, `nav-permissions.ts:105-110`) — visibility thật nằm
  trong `buildNavGroups()`, không trong registry.
- Flag mới: `isBizDirectorOnly = roles.length === 1 && roles[0] === 'giam_doc_kinh_doanh'`
  (strict single-role, giống `isTeacherOnly` — lý do an toàn giống hệt: nhiều gate của GĐKD
  cũng cấp cho role khác nên multi-role account phải giữ nav gốc không gộp).
- Ẩn khi `isBizDirectorOnly`: `overview` (thay bằng cockpit), giữ nguyên các mục còn lại theo
  đúng pattern `!isBizDirectorOnly && visible(key)` — **KHÔNG ẩn `finance`/`crm`/`cskh`/`rewards`**
  (khác teacher-nav) vì đây là nơi giám đốc thao tác thật, cockpit chỉ là màn tổng quan + lối tắt
  duyệt nhanh, không thay thế nghiệp vụ chi tiết.
- Cockpit hiển thị:
  1. Widget từ `dashboard.summary` (đã có, không đổi — `dashboard.ts:8-38`): doanh thu, pipeline,
     học sinh active, lớp mở.
  2. Hộp duyệt từ `dashboard.myApprovals` (Phase 1): receipt-pending, rewards-pending,
     shift-reg(KINH_DOANH)-pending, kpi-pending — mỗi item có nút hành động gọi thẳng mutation
     đã có (`receiptApprove`, `rewards.review`, `shiftRegistration.approve`, `kpiEvalConfirm`/`kpiEvalApprove`)
     — **không tạo mutation mới**, chỉ gọi lại.
- Rendering: thêm `case 'biz-director-cockpit'` trong `App.tsx` dispatch (theo mẫu `:636-637,720-721`),
  import component mới `BizDirectorCockpitPanel`.

## Architecture
Component mới `apps/admin/src/biz-director-cockpit-panel.tsx` — compose `dashboard.summary` +
`dashboard.myApprovals`, không chứa business logic mutation (gọi thẳng router hiện có).

## Related code files
- `apps/admin/src/shell.tsx` (`buildNavGroups`, `SECTION_TITLES`, flag mới)
- `apps/admin/src/nav-permissions.ts` (placeholder gate mới)
- `apps/admin/src/App.tsx` (dispatch case + import)
- `apps/admin/src/biz-director-cockpit-panel.tsx` (mới)

## Implementation Steps
1. Xác nhận Phase 1 xong (`dashboard.myApprovals` tồn tại và test xanh) trước khi bắt đầu.
2. Thêm `NAV_GATES.biz-director-cockpit = {kind:'open'}`.
3. Thêm flag `isBizDirectorOnly` trong `buildNavGroups()`, section mới `visible: isBizDirectorOnly`,
   `overview` đổi thành `visible: !isBizDirectorOnly && visible('overview')`.
4. `SECTION_TITLES` thêm entry.
5. Viết `BizDirectorCockpitPanel` — 2 widget (summary + approvals), nút hành động gọi mutation có sẵn.
6. `App.tsx` thêm dispatch case + import.

## Todo list
- [x] Phase 1 xong (dependency check)
- [x] `NAV_GATES` placeholder mới
- [x] `isBizDirectorOnly` flag + nav visibility logic
- [x] `SECTION_TITLES` entry
- [x] `BizDirectorCockpitPanel` component (summary widget + approval inbox widget)
- [x] `App.tsx` dispatch case
- [x] Multi-role account (vd `giam_doc_kinh_doanh`+`giao_vien`) verify KHÔNG bị gộp nav

## Success Criteria
Account chỉ có role `giam_doc_kinh_doanh` → thấy cockpit thay `overview`, duyệt được trực tiếp
từ hộp duyệt. Multi-role account → nav gốc không đổi (an toàn).

## Risk Assessment
Thấp — theo đúng pattern đã kiểm chứng ở teacher-nav. Rủi ro: quên strict single-role check →
multi-role account mất quyền truy cập nav gốc (đã có tiền lệ bug này được audit-fix ở teacher-nav
phase-04, xem ghi chú "Sửa sau audit" trong plan giáo viên).

## Next steps
Phase 5 viết test `nav-director-kd-cockpit-consolidation.test.ts` theo mẫu
`nav-teacher-consolidation.test.ts`.
