# Brainstorm: E2E full-lifecycle walkthrough + bộ hướng dẫn theo vai trò

Date: 2026-07-05. Branch: develop. Follow-up của `brainstorm-260705-0944-enrollment-session-provisioning-friction-report.md`.

## Problem statement

Hệ thống nghiệp vụ đầy đủ nhưng KHÔNG có hướng dẫn sử dụng — hiện chỉ 2 giám đốc + IT dùng, quy trình lớn (HR→lớp→CRM→phiếu thu→học sinh→điểm danh→đánh giá→ảnh cho PH) không ai nắm trọn. Triệu chứng điển hình: chạy CRM tới O5 tưởng lỗi vì "không thấy học sinh" — thực ra bước Sale tạo Phiếu thu → Kế toán duyệt là thao tác tay chưa được document (student sinh atomic tại `finance.receiptApprove`, finance.ts:791-801, theo decision 0033).

## Requirements (đã chốt)

- **Expected output**: (1) bộ hướng dẫn tiếng Việt theo vai trò trong `docs/guides/`, kèm screenshot thật từng bước; (2) report bug tìm thấy (đã fix / backlog) trong `plans/reports/`.
- **Acceptance**: chạy trọn 9 chặng dưới đây trên stack local, mỗi chặng có screenshot + mục hướng dẫn "vai trò nào — bấm gì — thấy gì"; đích cuối: nhận xét/đánh giá + ảnh buổi học tới được PH.
- **Scope OUT**: 4 cải tiến đã chốt ở brainstorm 0944 (auto-gen sessions, enroll 2 bước, nút tạo phiếu thu trên O5, xoá modal tạo HS) — KHÔNG làm trong phiên này, đi plan riêng. Không đụng dev/prod server.
- **Constraints**: chỉ DB local; thao tác qua UI như người thật (browser automation, Chrome DevTools MCP), API/DB chỉ để verify hậu trường; hướng dẫn ghi đúng HIỆN TRẠNG (kể cả bước "Sinh lịch" thủ công).

## Quyết định vận hành phiên

| Quyết định | Chốt |
|---|---|
| Data state | Reset DB local sạch + seed tối thiểu (super_admin/giám đốc + danh mục cơ sở/khóa học); mọi thứ khác tạo sống qua UI |
| Email PH | Gửi THẬT tới email test manhquy.mqy@gmail.com; chụp email nhận được làm tư liệu |
| Fix policy | Bug chặn luồng → fix ngay, commit develop, chạy tiếp. Bug nhỏ/UX → log backlog trong report |

## 9 chặng thực thi

| # | Chặng | Vai trò | Verify chính |
|---|---|---|---|
| 0 | Reset DB + seed tối thiểu, dựng stack, login super_admin | IT | Stack sống |
| 1 | Tạo GV, sale/CSKH, kế toán (hồ sơ + email cá nhân bắt buộc), set password | HR/super_admin | **Từng staff login được bằng password** (rủi ro #1: STAFF_PASSWORD_LOGIN, decision 0031) |
| 2 | Tạo lớp: khóa học từ curriculum, slots tuần, ngày | Quản lý | Mã lớp tự sinh đúng format (decision 0036) |
| 3 | "Sinh lịch" buổi học (bấm tay — ghi đúng hiện trạng) | Quản lý | ClassSession đủ theo slots |
| 4 | CRM lead O1→O5 với tên HS + SĐT PH | Sale/CSKH | O5 xong; hướng dẫn ghi rõ "chưa có học sinh là đúng thiết kế" |
| 5 | Tạo Phiếu thu từ info O5 → kế toán duyệt | Sale + Kế toán | **Student + tài khoản PH + Enrollment + LMS account sinh atomic** |
| 6 | Email tài khoản tới PH (gửi thật) | (hệ thống) | PH nhận email thật, chụp lại |
| 7 | PH/HS login cổng học (phone-login Netflix-profile, Plan C) | PH/HS | Vào được, thấy lớp |
| 8 | Ngày học: điểm danh → nhận xét/đánh giá → upload ảnh → PH xem | GV → PH | **Đích cuối: nhận xét + ảnh tới PH** |

## Risks

- STAFF_PASSWORD_LOGIN chưa bật/hỏng ở local → tắc chặng 1; verify sớm ngay chặng 0.
- Brevo config local có thể chưa có API key → chặng 6 fallback sang verify outbox + note lại.
- Curriculum seed: chỉ UCREA + Bright I.G có content (Black Hole rỗng) — chọn khóa có content khi tạo lớp.
- Screenshot tự động qua Chrome DevTools MCP — nếu automation flaky ở màn nào, chụp tay bù, không block.

## Success metrics

- 9/9 chặng chạy xong hoặc chặng fail có bug-fix/ghi nhận rõ ràng.
- `docs/guides/` có hướng dẫn đủ 9 chặng, mỗi bước gắn vai trò + screenshot.
- Người mới (nhân viên tương lai) đọc hướng dẫn tự thao tác được không cần hỏi IT.

## Next steps

1. Thực thi 9 chặng theo thiết kế này (phiên execution, ngoài brainstorm).
2. Sau khi xong: review report 0944 → `/ck:plan` cho 4 cải tiến quy trình.

## Unresolved questions

- Brevo API key có sẵn trong `.env` local không (ảnh hưởng chặng 6) — kiểm tra tại chặng 0.
