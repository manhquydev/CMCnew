# Brainstorm: Action plan + persona QA + UX audit + UI rebuild roadmap

**Ngày**: 2026-07-03
**Kích hoạt bởi**: người dùng báo lỗi thật trên prod (chấm công crash, IP hiện trên UI, shift-config placeholder) + yêu cầu đội QA đa vai trò + rebuild UI

## Vấn đề (bằng chứng)

- Chấm công crash với lỗi Prisma thô (`employmentProfile.findUniqueOrThrow` — no record). Xác nhận 4/4 tài khoản staff prod không có EmploymentProfile.
- `checkin-panel.tsx:122` hiện raw IP address (`Ngoài mạng công ty (162.159.98.92) — cần manager duyệt`) — UX không chuyên nghiệp cho non-technical user.
- `/shift-config` chứa dữ liệu seed placeholder (KINH_DOANH/GIAO_VIEN, ca1/2/3 giờ mặc định), không phải dữ liệu thật của công ty.
- Không có cơ chế phát hiện các vấn đề UI/UX tương tự có hệ thống — chỉ phát hiện được khi user report thủ công.
- `plans/260629-2127-odoo-parity-ux-framework/plan.md` (status: proposed) đã đề xuất đúng framework log/filter/view dùng chung mà user muốn, nhưng chưa triển khai.

## Quyết định

Chia thành 4 hạng mục độc lập, thứ tự: **A trước → B+C song song → D hoãn**.

### A — Action plan sửa lỗi/thiếu sót đã phát hiện
Danh sách: Brevo env wiring (đã fix), EmploymentProfile crash (đã fix), IP leak UX (chưa), shift-config data (cần operator), EmploymentProfile onboarding (cần operator), 3 mục DEBT.md thiếu UI caller, CI required-check chưa post ổn định.

### B — Đội persona QA (6 agent, 1 đợt)
6 vai trò (sale, giáo viên, GĐ kinh doanh, GĐ đào tạo, học sinh, phụ huynh), mỗi agent không có bối cảnh hệ thống trước, dùng browser automation thao tác thật trên **prod** (user cho phép toàn quyền test — "dữ liệu hiện tại của tất cả môi trường với cả prod vẫn chỉ đang trong quá trình phát triển"). Dữ liệu test gắn tiền tố `[QA-TEST]`. Chạy 1 đợt, đánh giá hiệu quả trước khi quyết định có làm cơ chế lặp lại hay không.

### C — UX audit
Dùng `ui-ux-designer` subagent tổng hợp phát hiện từ B + rà theo `docs/design-system.md`.

### D — Rebuild UI bằng `/stitch` (hoãn)
Dùng plan Odoo-parity UX Framework làm khung sườn, chờ B+C xong mới bắt đầu.

## Rủi ro & lưu ý

- Chạy persona QA trên prod thật có rủi ro gửi email thật qua Brevo (vừa bật) cho "phụ huynh giả" — cần agent tự nhận biết và tránh trigger email thật khi có thể, hoặc chấp nhận rủi ro nhỏ này (user đã authorize).
- A's item về EmploymentProfile/shift-config cần **hành động của operator (bạn)**, không phải code — plan nên ghi rõ đây là action-item cho người, không phải task cho agent.

## Next

`/ck:plan` cho A (nhỏ, làm ngay) và B+C (persona QA + UX audit) riêng biệt.
