# F2 — Trang chi tiết học sinh + fix bug lịch

Rủi ro: TB. Phụ thuộc: F1. Mở đường: F4.

## Context
- `plans/reports/compare-260626-2218-erp-lms-vs-openeducat-odoo-admissions-report.md` (thiếu detail view)
- `plans/reports/gap-analysis-260626-2338-business-completeness-report.md` (2 bug lịch)

## Requirements
1. **Trang chi tiết học sinh** (Student Detail) với tab: Thông tin HS (đầu vào), Phụ huynh, Enrollment (lớp/khoá), Lịch sử cơ hội (Opportunity), Receipt/thanh toán, Điểm/test. Thay cho việc nhảy panel Guardians riêng.
2. **List Students** chỉ còn: lọc/tìm, xem, sửa **các trường được phép** (chốt tập field bất biến vs sửa-được). Không tạo, không xoá.
3. **Fix bug lịch P0:**
   - Query trùng lịch nạp toàn bộ lịch sử session của cơ sở — thêm **lọc theo ngày** (`schedule.ts:151-153`).
   - `ClassSession.roomId/teacherId` thiếu FK — thêm **foreign key** + migration (`schema.prisma:269-288`).

## Files (dự kiến)
- `apps/<staff>/src/student-detail.tsx` (mới) + route.
- `apps/admin/src/students-panel.tsx`: rút gọn còn lọc/xem/sửa-field-cho-phép; link sang detail.
- `apps/api/src/routers/student.ts`: query tổng hợp detail (enrollment+guardian+opportunity+receipt+grade) — tôn trọng RLS.
- `apps/api/src/routers/schedule.ts`: thêm date filter.
- `packages/db/prisma/schema.prisma`: FK room/teacher + migration.

## Steps
1. Chốt tập field Student sửa-được sau khi thành HS (cần user).
2. API detail tổng hợp (read-only, RLS-safe).
3. UI detail theo tab (dùng primitive F3 nếu đã có; nếu chưa, tạm bản đơn giản).
4. Rút gọn list.
5. Fix 2 bug lịch + test trùng phòng/GV vẫn đúng sau khi thêm date filter.

## Validation
- Detail hiển thị đúng dữ liệu liên kết; không rò dữ liệu ngoài facility (RLS).
- List không còn nút tạo/xoá.
- Test trùng lịch: cùng kết quả nhưng query có lọc ngày; FK chặn room/teacher rác.
- build + typecheck xanh.

## Risks / Rollback
- Thêm FK có thể lộ dữ liệu rác hiện có (roomId/teacherId mồ côi) → cần data-cleanup migration trước.
