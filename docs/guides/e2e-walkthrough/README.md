# Hướng dẫn E2E theo vai trò — CMCnew ERP+LMS

Bộ hướng dẫn này được viết ra từ 1 lần chạy thật (browser automation) toàn bộ vòng đời nghiệp vụ trên stack dev local, ngày 2026-07-05. Mỗi chặng có ảnh chụp màn hình thật + verify SQL.

## Vai trò → Chặng

| # | Chặng | Vai trò | URL |
|---|---|---|---|
| 0 | [Reset & preflight](00-reset-preflight/guide.md) | IT | — |
| 1 | [Tạo nhân sự](01-hr-staff/guide.md) | HR / super_admin | `http://localhost:5173` |
| 2 | [Tạo lớp](02-class-create/guide.md) | Quản lý | `http://localhost:5173` |
| 3 | [Sinh lịch học](03-generate-sessions/guide.md) | Quản lý | `http://localhost:5173` |
| 4 | [CRM O1→O5](04-crm-o1-o5/guide.md) | Sale/CSKH | `http://localhost:5173` |
| 5 | [Lập phiếu thu + Duyệt](05-receipt-approve/guide.md) | Kế toán | `http://localhost:5173` |
| 6 | [Email tài khoản PH](06-parent-email/guide.md) | Kế toán (verify) | — |
| 7 | [Đăng nhập cổng học](07-portal-login/guide.md) | Phụ huynh/Học sinh | `http://localhost:5175` |
| 8 | [Ngày dạy: điểm danh+nhận xét+ảnh](08-teaching-day/guide.md) | Giáo viên | `http://localhost:5173` |

## Test creds dùng trong phiên này

| Vai trò | Đăng nhập | Ghi chú |
|---|---|---|
| super_admin | `admin@cmc.local` | Mật khẩu trong `.env` local |
| Giáo viên | `giaovien.test@cmcvn.edu.vn` | Mật khẩu tạm cấp lúc tạo staff |
| Kế toán | tạo ở chặng 1 | Đăng nhập bằng password (STAFF_PASSWORD_LOGIN, quyết định 0031) |
| PH (chặng 5-8) | email nhập lúc duyệt phiếu, SĐT `0987654321` | OTP hiện thẳng trên UI ở dev mode |
| HS | mã đăng nhập + mật khẩu tạm hiện lúc duyệt phiếu (vd `HQ-HS-2026-0001` / `Cmc2026@`) | Chỉ hiện 1 lần |

## Điểm khác so với giả định ban đầu

- Đăng nhập PH ở cổng LMS: **email + OTP**, không phải chọn SĐT/hồ sơ kiểu Netflix.
- Module Tài chính chỉ Kế toán/GĐ kinh doanh thấy — Sale không tạo phiếu thu.
- "Ảnh & nhận xét LMS" gate chặt theo giờ thật (chỉ mở sau giờ kết thúc buổi) — dùng buổi học bù để test không cần chờ.

## Bug tìm thấy + đã sửa trong phiên này

Xem đầy đủ tại `../../../plans/260705-1006-e2e-full-lifecycle-walkthrough-guide/reports/bug-log.md`. Tóm tắt:

- **#5 (đã sửa)**: thêm timeout cho Graph/Brevo client — vệ sinh code, gap thật dù chưa xác nhận là nguyên nhân treo API.
- **#9 (đã sửa, bug thật)**: `receiptApprove` không gửi email chào mừng LMS khi email nhập lúc duyệt (chỉ đọc `receipt.parentEmail` thay vì `input.parentEmail`). Commit `5a225a6`.
- **#10 (backlog)**: `receiptApprove` crash 500 thô nếu 2 phụ huynh mới dùng trùng email (edge case, không chặn luồng chính).
- **#4 (chưa xác nhận nguyên nhân)**: API từng treo cứng hoàn toàn 2 lần, nghi ngờ Graph/email nhưng đã bác bỏ qua test cô lập — cần phiên debug riêng nếu tái diễn.
