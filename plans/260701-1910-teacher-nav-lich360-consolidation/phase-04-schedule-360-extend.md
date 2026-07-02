# Phase 04 — Mở rộng Lịch 360: thêm Chấm bài + Họp PH

**Status: DONE** — `GradingPanel`/`MeetingsPanel` nhận optional `initialFacilityId`/`initialBatchId` (default `{}`, không phá cách gọi cũ ở case 'grading'/'meetings'). 2 `WorkflowCard` mới trong `SessionWorkflowPanel` (schedule-detail.tsx), gate bằng `can('grade','grade')`/`can('parentMeeting','setStatus')` + `postClassEnabled`. Đơn giản hoá 1 điểm so với mô tả gốc: "Họp PH mở nếu buổi có lịch họp gắn kèm" — dữ liệu session hiện không có field liên kết cuộc họp, nên card này chỉ gate theo `postClassEnabled` giống Chấm bài (không có field để kiểm tra thêm).

## Quyết định thiết kế (CHỐT): thêm prop preselect
`GradingPanel`/`MeetingsPanel` hiện **không nhận prop nào** — tự fetch danh sách cơ sở, để user tự chọn cơ sở/lớp/bài tập, không tự lọc theo buổi đang xem. Đã chốt: thêm prop TÙY CHỌN (`initialBatchId?`/`initialSessionId?` hoặc tương đương) vào `GradingPanel`/`MeetingsPanel` để preselect theo session đang xem trong Lịch 360 — đúng tinh thần "đã ở sẵn đúng buổi, chỉ việc chấm". Yêu cầu bắt buộc: prop phải OPTIONAL, mặc định `undefined` giữ nguyên hành vi hiện tại ở `case 'grading'`/`case 'meetings'` (route độc lập trong `App.tsx`) — không phá cách gọi cũ ở đó.

## Files
- Sửa: `apps/admin/src/schedule-detail.tsx` — trong `SessionWorkflowPanel` (dòng 116-172, đã xác nhận khớp code), thêm 2 `WorkflowCard` mới: "Chấm bài" (`enabled` khi phase phù hợp + user có quyền `grade.grade`) và "Họp PH" (`enabled` khi phase phù hợp + user có `parentMeeting.setStatus`). `WorkflowCard` chỉ có 4 prop đã xác nhận: `{ title: string; description: string; enabled: boolean; children?: React.ReactNode }` — không có `action`/`status`, phải tự render nội dung qua `children`.
- KHÔNG sửa `getSessionPhase()` (dòng 45-52) hay `PHASE_META` (54-75) — chỉ thêm card đọc `phase` có sẵn.

## Bước làm
1. Thêm prop optional (`initialBatchId?`, `initialSessionId?` — đặt tên khớp state nội bộ thật của 2 component sau khi đọc lại) vào `GradingPanel`/`MeetingsPanel`; dùng để preselect state chọn lớp/buổi thay vì để user tự chọn từ đầu.
2. Thêm 2 `WorkflowCard` vào `SimpleGrid` hiện có trong `SessionWorkflowPanel`, `enabled` tính từ `phase` (chấm bài mở từ `post_class`; họp PH mở nếu buổi có lịch họp gắn kèm); truyền `initialBatchId`/`initialSessionId` từ `session` hiện tại.
3. Panel nhúng vẫn tự gọi API + tự check quyền qua `can()` như hiện tại — màn Lịch 360 chỉ là nơi hiển thị, không bypass quyền.

## Test
- Giáo viên KHÔNG có `grade.grade`: card "Chấm bài" không hiện hoặc hiện dạng disabled — không hiện form chấm bài.
- Giáo viên có đủ quyền: mở thẻ "Chấm bài"/"Họp PH" trong Lịch 360 → panel tự chọn sẵn đúng lớp/buổi đang xem (không phải chọn lại từ đầu).
- `case 'grading'`/`case 'meetings'` trong `App.tsx` (route độc lập cho role khác/truy cập trực tiếp) vẫn hoạt động y hệt cũ khi không truyền prop mới (regression test bắt buộc).

## Rủi ro
TRUNG BÌNH (nâng từ THẤP sau audit) — điểm mở rộng `WorkflowCard` có sẵn theo thiết kế gốc, nhưng việc 2 panel không có cơ chế preselect theo session là khoảng trống thật, cần quyết định UX trước khi ước tính công sức chính xác.
