# Stage 01 — Research (inspect first)

Rule: INSPECT what already exists. Evidence required — links, quotes, screenshots.
"I think there's nothing like this" without searching = gate fail.

> Project type (`/flow project-type`, default `web`): items 2 and 4 below are written for a
> **web / market-facing product**. For an **internal tool / cli / library / skill** (no public
> market), use the non-web framing in each item — it is still real evidence (first-party
> friction, who-benefits), NOT an excuse to skip. The semantic gate refuses a market product
> that hides behind the soft framing.

## Gate — check ALL before `/flow next`
- [x] I actually OPENED 3 existing tools/competitors (links below, with one honest note each)
- [x] **(web)** I found 3 REAL user complaints online, quoted, with source links — **OR (non-web/internal)** I named the concrete first-party friction / observed pain that justifies this
- [x] I wrote what competitors CHARGE (real prices) and who pays — **OR (non-web)** what people spend AROUND this problem today (time, a worse tool, manual work)
- [x] **(web)** I named the ONE channel my first 10 users come from (a place, not "social media") — **OR (non-web/internal)** I named who benefits and how they hear about it (release notes / team), and noted "no market channel" is NOT a kill signal for an internal tool
- [x] I wrote why those users would pick this over the status quo (one honest paragraph)
- [x] I wrote what is technically free vs hard for this idea
- [x] No FILL placeholders remain in this file

## What exists already (3 — open them, don't guess)

1. Odoo ERP Login (https://www.odoo.com): Thiết kế đơn giản, tập trung vào form login, hỗ trợ SSO, nhưng giao diện mặc định khá đơn điệu và khó tùy chỉnh sâu nếu không viết thêm template QWeb.
2. SAP SuccessFactors Login (https://www.sap.com): Giao diện rất hiện đại, dùng background hình ảnh chất lượng cao hoặc canvas nghệ thuật ở một bên, form login nằm gọn một bên rất chuyên nghiệp nhưng chi phí triển khai cực kỳ đắt đỏ.
3. Microsoft 365 Login (https://login.microsoftonline.com): Giao diện login chuẩn mực, tối giản tuyệt đối, chuyển đổi tài khoản mượt mà, UX hoàn hảo nhưng chỉ bó hẹp trong hệ sinh thái của Microsoft.

## What users say (web: 3 real complaints quoted+linked · non-web: real first-party friction)

1. > Phản hồi từ Báo cáo UI Audit [ui-audit-260626](file:///d:/project/CMCnew/plans/reports/ui-audit-260626-2338-unified-erp-redesign-direction-report.md#L118): Màu xanh lam của tiêu đề "CMC · Admin" dễ bị nhầm lẫn là một đường link liên kết thay vì tiêu đề tĩnh.
2. > Trải nghiệm DX (Employee Experience) tẻ nhạt: Giao diện đăng nhập hiện tại chỉ có một khung trắng trơn trên nền trắng toát, không tạo cảm hứng làm việc hay thể hiện bản sắc văn hóa sáng tạo "THINK · CREATE · LEAD" của CMC.
3. > Thiếu tối ưu trên Mobile: Khoảng cách giữa các nút "Đăng nhập" và "Đăng nhập bằng tài khoản CMC EDU" quá sát, dễ bấm nhầm trên màn hình cảm ứng điện thoại.

## GTM & business reality

Building is the cheap part now. Distribution and willingness-to-pay are where ideas die —
research them BEFORE planning, not after shipping.

### Who pays today, and how much (pricing reference points)

- Đội ngũ vận hành CMC ERP tốn tài nguyên thiết kế UI/UX để cải thiện tinh thần làm việc của nhân viên (Employee Experience).
- Chi phí đầu tư: Khoảng 1-2 ngày công phát triển (dev-hours) của lập trình viên nội bộ để làm đẹp UI/UX, không phát sinh chi phí mua bản quyền bên thứ ba do dùng sẵn thư viện `@mantine/core`.

### The first-10-users channel (web) · who-benefits (non-web/internal)

Toàn bộ nhân viên, giảng viên và ban điều hành CMC (staff shell) sử dụng hệ thống ERP hàng ngày. Họ sẽ nhận biết sự thay đổi ngay khi phiên bản mới được deploy thông qua thông báo cập nhật hệ thống và màn hình chào mừng lúc đăng nhập.

### Why switch (vs the status quo)

Giao diện mới mang lại cảm giác hiện đại, chuyên nghiệp ngay từ lần chạm đầu tiên vào hệ thống. Việc cải thiện spacing, thêm background gradient sang trọng, sửa lỗi hiển thị tiêu đề và tối ưu hóa nút SSO Microsoft giúp quá trình đăng nhập diễn ra nhanh chóng, ít sai sót và gia tăng niềm tự hào thương hiệu của nhân viên đối với CMC.

## Technically free vs hard

- Free (solved by libraries/platforms): Thư viện Mantine UI (`@mantine/core`) đã được tích hợp sẵn, CSS variables và theme cấu hình trong `theme.ts` đã được thiết lập.
- Hard (custom work, real risk): Thiết kế background gradient/glassmorphism mượt mà mà vẫn đảm bảo tốc độ tải trang nhanh, không bị giật lag; đảm bảo tương thích tốt các kích thước màn hình từ Desktop đến Mobile mà không phá vỡ layout.
