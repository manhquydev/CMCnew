---
phase: 1
title: "Nav simplification"
status: pending
priority: P1
effort: "S"
dependencies: []
---

# Phase 1: Nav simplification

## Overview

Đơn giản hóa nav teacher-lite: lược bỏ toàn bộ section ERP-heavy (sale/KPI/chấm công/finance/CRM/...) 
khỏi surface `teacher`, và gỡ KPI item khỏi 2 cockpit (PAR-1 dead-end). Chỉ giữ section phục vụ 3 vai
trò lõi. KHÔNG xóa backend/router/RLS — chỉ điều chỉnh visibility surface (tuân thủ Decision 0039).

## Requirements
- Functional: nav teacher-lite chỉ hiện dạy học (GV) + lớp/HS/PH/nhân sự-gọn (giám đốc) + LMS-liên quan.
- Functional: KPI approval item không còn trong cockpit → không redirect dead-end.
- Non-functional: ERP surface KHÔNG đổi; giám đốc vẫn dùng ERP đầy đủ qua nút "Mở ERP đầy đủ".

## Architecture
- `apps/admin/src/app-surface.ts` — `TEACHER_SURFACE_SECTIONS` Set: **bỏ** các key ERP-heavy. Giữ:
  `overview, schedule, attendance-report, assessment, classes, courses, student-mgmt, students,
  guardians, family-intake, meetings, levelup, edu-director-cockpit, biz-director-cockpit, profile`,
  và (mới, Phase 5) staff-mgmt-lite. **Bỏ khỏi Set** (nếu đang có): kpi, checkin, shift-registration,
  finance, crm, cskh, rewards, badges, revenue-report, reconcile-worklist, compensation,
  my-payslips, payroll-checkin, org, facility-network, shift-config.
- `apps/admin/src/edu-director-cockpit-panel.tsx` + `biz-director-cockpit-panel.tsx` — bỏ `kpi` khỏi
  `INLINE_APPROVE_DOMAINS` / danh sách approval item để không route tới `/kpi`.
- `apps/admin/src/shell.tsx` — teacher-surface flatMap tự lọc theo Set; verify group nào rỗng thì ẩn.

## Related Code Files
- Modify: `apps/admin/src/app-surface.ts` (TEACHER_SURFACE_SECTIONS)
- Modify: `apps/admin/src/edu-director-cockpit-panel.tsx`, `apps/admin/src/biz-director-cockpit-panel.tsx` (bỏ KPI item)
- Verify (no change expected): `apps/admin/src/shell.tsx` (buildGroups teacher flatMap), `apps/admin/src/App.tsx` (isReachableSection)

## Implementation Steps
1. Đọc `app-surface.ts` — chốt danh sách key ERP-heavy đang trong Set → xóa chúng.
2. Đọc 2 cockpit panel — tìm nơi thêm KPI approval item / route `onNavigateToKpi` → gỡ item (giữ các approval khác).
3. Verify `isReachableSection` (App.tsx): section bị bỏ khỏi Set → teacher surface redirect về default (không crash) — đúng behavior.
4. Verify group rỗng (vd "Công ca", "CRM & Kinh doanh", "Tài chính", "Nhân sự") không hiện header trống trên teacher surface.
5. `pnpm --filter admin exec tsc --noEmit`.

## Success Criteria
- [ ] Login teacher-lite (SA/giám đốc/GV) → KHÔNG thấy sale/KPI/chấm công/finance/CRM trong nav.
- [ ] Cockpit không còn KPI approval item; không có redirect loop `/kpi`.
- [ ] ERP surface (erp.cmcvn.edu.vn) không đổi.
- [ ] `tsc --noEmit` 0 lỗi.
- [ ] Live verify: nav gọn trên devteacher.

## Risk Assessment
- Rủi ro: bỏ section khỏi Set làm director mất direct-URL tới section đó trên teacher surface → chấp
  nhận (họ dùng ERP surface; redirect graceful). Ghi rõ trong PR.
- Rủi ro: cockpit KPI item có thể là approval thật đang dùng → xác nhận với dữ liệu: KPI bị lược bỏ theo
  chỉ đạo user; nếu giám đốc cần duyệt KPI thì làm ở ERP surface.
