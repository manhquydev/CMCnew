# Phase 2 — Sale: CRM screen → pipeline-first default view

## Context links
Parent: `plan.md`. Scout mục B + Open Q1/Q2. Độc lập với Phase 1 (chạy song song được).

## Overview
- Priority: P2 | Status: done
- **Phạm vi đã thu hẹp so với brainstorm ban đầu** (xem plan.md "Phát hiện thật" #1-2): sale
  chỉ có 1 nav item liên quan (`crm`) — không có nav để gộp. Việc thật là tái cấu trúc
  `crm-panel.tsx` thành pipeline-first, KHÔNG tạo `SectionKey` mới, KHÔNG đổi `NAV_GATES`.

## Requirements
- Kanban (`OppKanban`, `apps/admin/src/crm-panel.tsx:54-120`) là **default view** khi mở màn CRM,
  thay vì cần `ViewSwitcher` (`crm-panel.tsx:151-155,364-390`) bấm chuyển từ table.
- Test-schedule ("Lịch test" table, `crm-panel.tsx:393-424`) và contact quick-actions trở thành
  **drill-down từ `OpportunityDetailPanel`** (`crm-panel.tsx:36,241-249`, route `/crm/opportunities/:id`)
  thay vì list rời nằm dưới kanban — giảm số thứ phải cuộn/tìm khi làm việc với 1 deal.
- **KHÔNG đổi**: `canGrade` vẫn ẩn nút chấm test cho sale (`crm-panel.tsx:146`, đúng theo
  `crm.testGrade` gate hiện tại chỉ cấp `giao_vien`/`giam_doc_dao_tao`, `permissions.ts:105`).
- **KHÔNG đổi**: `PERMISSIONS.crm.*`, không thêm quyền `cskh`/`rewards` cho sale.
- Áp dụng cho MỌI role thấy `crm` (không chỉ sale) — đây là cải thiện UX chung của màn CRM, không
  phải gate theo role (khác với teacher-nav vốn ẩn/hiện theo role).

## Architecture
Thuần frontend, 1 file chính (`crm-panel.tsx`), không đổi API, không đổi permission registry,
không cần `nav-consistency.test.ts` cập nhật (không có gate mới).

## Related code files
- `apps/admin/src/crm-panel.tsx` (đổi default view state, di chuyển test-schedule/contact vào
  drill-down)
- `apps/admin/src/__tests__/` — không cần test nav mới (không đổi nav), nhưng nếu có test UI cho
  `crm-panel.tsx` hiện có thì phải rerun (kiểm tra trước khi sửa xem có file test nào import
  component bị di chuyển không).

## Implementation Steps
1. Đọc toàn bộ `crm-panel.tsx` (427 dòng) trước khi sửa — xác nhận không có side-effect khác
   phụ thuộc vị trí hiện tại của test-schedule/contact list.
2. Đổi state khởi tạo `useViewSwitcher` (`:151-155`) để mặc định `'kanban'` thay vì đọc theo thứ
   tự cũ (giữ nguyên khả năng chuyển sang table).
3. Di chuyển block "Lịch test" (`:393-424`) + contact quick-actions vào bên trong
   `OpportunityDetailPanel` (drill-down khi click card), giữ nguyên logic gọi API
   (`crm.testList`, `crm.testCreate`, `crm.testGrade`) — chỉ đổi vị trí render, không đổi query.
4. Giữ nguyên inline create form (`:327-362`) — không thuộc phạm vi.

## Todo list
- [x] Đọc hết `crm-panel.tsx` xác nhận không side-effect
- [x] Default view = kanban
- [x] Di chuyển test-schedule vào drill-down `OpportunityDetailPanel`
- [x] Di chuyển contact quick-actions vào drill-down
- [x] `canGrade`/quyền không đổi — verify bằng test thủ công với account sale
- [x] Build + lint sạch

## Success Criteria
Mở màn CRM → thấy kanban ngay, không cần bấm chuyển view. Click 1 card → thấy đủ thông tin
(contact, test-schedule, lịch sử) trong 1 nơi. Không nút/quyền nào bị lộ thêm cho sale.

## Risk Assessment
Thấp — thuần UI, không đổi contract/quyền. Rủi ro duy nhất: di chuyển component làm mất
prop/callback nào đó — giảm bằng bước đọc hết file trước khi sửa (bước 1).

## Security Considerations
Không có thay đổi authorization trong phase này — đã xác nhận trong plan.md phần "Out of scope".

## Next steps
Không phase nào phụ thuộc phase này.
