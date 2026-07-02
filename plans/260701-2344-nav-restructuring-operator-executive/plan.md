---
title: "Nav restructuring — Sale Pipeline default-view + 2 giám đốc Executive Cockpit"
description: "Tiếp nối pattern Lịch 360 (giáo viên) cho sale (operator) và 2 giám đốc (executive) — dựa trên scout thật, không phải giả định"
status: completed
priority: P2
effort: 16h
branch: develop
tags: [nav, ux, dashboard, admin, rbac-aware]
created: 2026-07-01
---

# Nav restructuring — Operator (sale) + Executive (2 giám đốc)

Scout gốc: `plans/reports/from-scout-agent-260701-2344-nav-dashboard-sale-director-report.md`
(nội dung đầy đủ nằm trong task-notification agent `ae8d4d0921cd1a4af`, tóm tắt lại dưới đây
và trong từng phase file — không phịa, mọi con số/file:line đều từ agent Explore đọc code thật).

## Bối cảnh

Tiếp nối brainstorm trước (giáo viên → "Lịch 360" tại `plans/260701-1910-teacher-nav-lich360-consolidation/`):
2 loại người dùng khác bản chất — **operator** (sale, nhập liệu hằng ngày, neo vào pipeline) và
**executive** (2 giám đốc, duyệt + giám sát, cần cockpit + hộp duyệt thay vì menu rời).

## Phát hiện thật làm ĐỔI phạm vi so với brainstorm ban đầu

1. **Sale hiện KHÔNG có `cskh`/`rewards` trong nav** (`shell.tsx` derive từ `NAV_GATES` —
   `afterSale.list`/`rewards.giftCreate` không cấp cho `sale`, `permissions.ts:29,201`). Gộp 2
   mục này vào "Pipeline 360" đòi **đổi quyền** (Authorization = hard gate theo
   `docs/FEATURE_INTAKE.md`) — **NGOÀI PHẠM VI plan này**, cần decision record riêng nếu muốn.
2. Sale chỉ thật sự có **1 nav item liên quan** (`crm`) — không phải nhiều menu rời như giả định
   ban đầu. Nên "Pipeline 360" cho sale KHÔNG phải gộp nav (không có gì để gộp), mà là
   **tái cấu trúc màn CRM sẵn có** (`crm-panel.tsx`) thành pipeline-first: kanban làm default
   view (đã tồn tại — `OppKanban`, `crm-panel.tsx:54-120` — chỉ chưa phải mặc định), contact/
   test-schedule trở thành drill-down từ card thay vì list rời bên dưới.
3. **2 giám đốc có permission set gần như tách biệt** (KD: CRM/tài chính/CSKH/rewards/duyệt ca
   KD; DT: học vụ/KPI/levelup/duyệt ca DT) → **2 cockpit riêng**, không gộp chung 1 màn — theo
   đúng pattern an toàn đã dùng cho giáo viên (`isTeacherOnly` single-role strict check,
   `shell.tsx:372-376`).
4. **4/7 hành động duyệt đã có sẵn pending-list query** (`levelProgress.listPending`,
   `shiftRegistration.list({status})`, `checkInOut.pendingManual`, `rewards.pendingList`) — tái
   dùng được, không viết lại. **3 hành động chưa có** (`kpiEvalConfirm`/`kpiEvalApprove`,
   `receiptApprove`) — cần query/filter mới (Phase 1).
5. **`dashboard.summary` (permissions.ts:61-63) là contract công khai đang dùng làm gate cho nav
   `overview`** (`nav-permissions.ts:31-34`) — KHÔNG sửa shape của nó (tránh phá gate + caller
   hiện có). Thêm procedure MỚI thay vì sửa cái cũ.

## Quyết định đã chốt (kỹ thuật, không phải business — có căn cứ evidence ở trên)

- Không đổi `PERMISSIONS` registry trong plan này (giữ nguyên authorization hiện tại).
- 2 cockpit riêng cho 2 giám đốc, không gộp chung.
- `dashboard.summary` giữ nguyên; thêm `dashboard.myApprovals` (mới) cho hộp duyệt.
- Sale: không tạo `SectionKey` nav mới (không có gì để gộp) — chỉ tái cấu trúc UI bên trong
  `crm-panel.tsx` + đổi default view.

## Phases

| # | Phase | Phụ thuộc | Status | File |
|---|---|---|---|---|
| 1 | Backend: approval-inbox aggregate (`dashboard.myApprovals` + 3 query mới) | — | ✅ done | `phase-01-approval-inbox-backend.md` |
| 2 | Sale: CRM screen → pipeline-first default view | — (độc lập) | ✅ done | `phase-02-sale-pipeline-default-view.md` |
| 3 | GĐ Kinh Doanh: Executive Cockpit | Phase 1 | ✅ done | `phase-03-biz-director-cockpit.md` |
| 4 | GĐ Đào Tạo: Executive Cockpit | Phase 1 | ✅ done | `phase-04-edu-director-cockpit.md` |
| 5 | Test + nav-consistency guard + verification | Phase 1-4 | ✅ done (chờ commit) | `phase-05-tests-and-verification.md` |

## Trạng thái thật (verify 2026-07-02 00:xx, độc lập chạy lại sau khi phiên bị restart giữa chừng)
- **Toàn bộ 5 phase code + test XONG.** Số liệu thật: admin **27/27** test (4 file, gồm 2 test
  cockpit mới KD 6 + DT 7), admin typecheck 0 lỗi, admin build pass; api full suite **472/473**
  (1 fail pre-existing `email-graph-client`, không liên quan), api typecheck 0 lỗi.
- `dashboard.summary` public contract KHÔNG đổi (diff-verified chỉ thêm 1 dòng import type).
- 2 cockpit merge sạch cùng 4 file chung (`shell.tsx`/`nav-permissions.ts`/`App.tsx`/
  `nav-consistency.test.ts`) — `overview` composed `!isBizDirectorOnly && !isEduDirectorOnly`.
- **Deviation có lý do (chấp nhận):** nút duyệt KPI trong cockpit redirect sang màn KPI thay vì
  inline — vì `dashboard.myApprovals` item mang `kpiScore.id`, còn `kpiEvalConfirm/Approve` cần
  composite `{userId, periodKey}`; parse từ title là anti-pattern nên chọn redirect (GĐ vẫn có
  nav `kpi`). Domain `manualPunch` được wire thật (API có trả về).
- **Chờ commit** — working tree entangled với việc `curriculum` song song (chung file
  `permissions.ts`: hunk `myApprovals` là nav, `update/editSlot/removeSlot` là curriculum).
  Commit nav-only cần hunk-split `permissions.ts`. Chờ user duyệt phương án commit.

Phase 2 chạy song song được với Phase 1 (không phụ thuộc). Phase 3/4 chờ Phase 1 xong (cần
`dashboard.myApprovals`).

## Acceptance criteria (toàn plan)

- `dashboard.summary` public contract KHÔNG đổi (không caller nào vỡ).
- `dashboard.myApprovals`: role-aware, đúng authorization hiện có, tách biệt trách nhiệm (director
  vừa confirm KPI không thấy chính sheet đó trong "chờ tôi duyệt" — theo comment gốc `payroll.ts:184-189`).
- Sale CRM screen: kanban là default view, không mất chức năng cũ (contact/test-schedule vẫn
  truy cập được, chỉ đổi chỗ).
- 2 cockpit giám đốc: `isBizDirectorOnly`/`isEduDirectorOnly` strict single-role (giống
  `isTeacherOnly`) — multi-role account KHÔNG bị gộp nav (an toàn, theo đúng lý do gốc
  `shell.tsx:372-375`).
- `nav-consistency.test.ts` xanh sau khi thêm gate mới (không phantom gate, D-series pin cập nhật).
- Test mới cho 3 archetype theo đúng pattern `nav-teacher-consolidation.test.ts`.

## Out of scope (YAGNI, ghi rõ để không quên)

- Cấp `cskh`/`rewards` cho sale — cần quyết định RBAC riêng (Authorization = hard gate).
- Mở rộng `crm.testGrade` cho sale — giữ nguyên hạn chế hiện tại.
- Sửa shape `dashboard.summary` — chỉ thêm procedure mới.
- Pagination/cursor cho `crm.opportunityList`/`contactList` (hiện `take:200/take:100` — vấn đề
  scale riêng, không thuộc phạm vi UX restructuring này).

## Risks

- `dashboard.myApprovals` là contract MỚI — public API risk thấp (chưa có caller cũ để vỡ) nhưng
  vẫn phải qua `requirePermission` đúng như `dashboard.summary`.
- Cockpit ẩn bớt nav gốc (finance/crm/cskh/rewards/kpi/levelup) cho director-only account — theo
  đúng pattern `!isTeacherOnly && visible(key)` đã kiểm chứng an toàn ở teacher-nav, rủi ro thấp.
- Nếu tương lai có director 2-role (vd giám đốc kiêm cả 2), cockpit strict single-role sẽ tự
  fallback về nav gốc không gộp — đúng ý đồ an toàn, không phải bug.
