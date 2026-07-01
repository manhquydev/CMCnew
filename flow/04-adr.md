# Stage 04 — ADR (architecture decisions)

Short. The most valuable section is what you are NOT doing and why.

## Gate — check ALL before `/flow next`
- [x] Each decision has a one-line "why" and a one-line "what I rejected"
- [x] The NOT-doing list is written
- [x] Decisions cover: data storage, auth approach, deploy target
- [x] No FILL placeholders remain in this file

## Decisions

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| 1 | Sử dụng `@mantine/core` v7 kết hợp CSS variables từ `tokens.css` cho UI styling. | Đảm bảo tính nhất quán với theme Apple-flat của dự án, dễ maintain và kế thừa. | Dùng Tailwind CSS độc lập hoặc CSS Modules mới (tăng bundle size, khó đồng bộ theme). |
| 2 | Giữ nguyên cơ chế auth cục bộ và SSO Microsoft qua tRPC. | Đảm bảo luồng đăng nhập hiện tại không bị lỗi và an toàn bảo mật tuyệt đối. | Tự thiết kế lại logic Auth hoặc session client mới (vượt quá scope UI/UX và có nguy cơ lỗi bảo mật). |
| 3 | Sử dụng CSS background gradient kết hợp CSS `backdrop-filter: blur(...)` cho hiệu ứng Glassmorphism. | Tiết kiệm băng thông, không cần tải ảnh nền nặng, giúp trang login load < 1 giây. | Sử dụng ảnh nền chất lượng cao hoặc canvas động (làm chậm trang và tốn data của user di động). |

## NOT doing in v1 (and why it's safe to skip)

- Thay đổi database schema hay logic API backend (Hoàn toàn an toàn để skip vì yêu cầu chỉ tập trung làm đẹp UI/UX).
- Tạo trang đăng ký mới hoặc quên mật khẩu local (Do CMC ERP chỉ dùng cho nội bộ nhân viên, tài khoản do admin cấp hoặc dùng SSO Microsoft, không tự đăng ký).
