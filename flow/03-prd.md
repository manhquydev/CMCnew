# Stage 03 — PRD

1-2 pages max. Test: could a stranger build v1 from this without asking you anything?

## Gate — check ALL before `/flow next`
- [x] Every section below is filled from MY scope decision (stage 02), not re-expanded
- [x] Success metric is a NUMBER, not vibes ("save time" fails; "first response < 2h" passes)
- [x] Each feature names the user action and the observable result, tagged with a stable `FRn:` id
- [x] Pain & gain is a MAPPING TABLE: every pain cites evidence (a stage-01 quote or a named observation), and names the v1 feature that kills it; every v1 feature kills at least one pain
- [x] A stranger could build v1 from this without asking me anything
- [x] No FILL placeholders remain in this file

## Context

Dự án CMCnew (ERP + LMS) đang xây dựng lại nền tảng từ đầu. Trang đăng nhập ERP hiện tại của nhân viên rất đơn điệu (nền trắng tinh, tiêu đề màu xanh lam dễ gây nhầm lẫn với link, các nút bấm quá gần nhau). Cần nâng cấp UI/UX để mang lại giao diện làm việc chuyên nghiệp, có tính thẩm mỹ cao, phù hợp với Apple-flat design của dự án.

## Target users

Nhân viên vận hành, nhân viên giáo vụ và ban quản trị (Staff / Admin) của CMC sử dụng hệ thống ERP hàng ngày.

## Pain & gain (mapping table — the traceability spine of the PRD)

Every row: a concrete pain, the evidence it's real, what people do about it today, the
ONE v1 feature that kills it, and the observable gain. If a feature kills no pain, cut
it; if a pain has no feature, it goes to the "not addressed" list — honestly.

| # | Persona | Pain (concrete) | Evidence (stage-01 quote/source or named observation) | Today's workaround | V1 feature that kills it | Observable gain |
|---|---|---|---|---|---|---|
| P1 | Staff / Admin | Màu xanh lam của tiêu đề "CMC · Admin" dễ gây nhầm lẫn là link liên kết | Báo cáo UI Audit [ui-audit-260626](file:///d:/project/CMCnew/plans/reports/ui-audit-260626-2338-unified-erp-redesign-direction-report.md#L118) | Click thử vào tiêu đề để xem có chuyển trang không | FR1: Tiêu đề tĩnh dạng chữ tối, phẳng | Tiêu đề hiển thị rõ ràng, không gây nhầm lẫn. |
| P2 | Staff / Admin | Giao diện login màu trắng toát đơn điệu, thiếu tính thẩm mỹ và cảm xúc chào đón | Nhận xét về Employee Experience (DX) tẻ nhạt | Chấp nhận giao diện thô sơ | FR2: Layout background gradient tối sang trọng và Glassmorphism | Giao diện đăng nhập hiện đại, bắt mắt, tạo cảm giác chuyên nghiệp. |
| P3 | Staff / Admin | Dễ bấm nhầm giữa nút đăng nhập và nút SSO Microsoft trên mobile do khoảng cách quá sát | Quan sát thực tế lỗi click nhầm trên thiết bị cảm ứng di động | Thao tác cẩn thận hoặc zoom màn hình để bấm | FR3: Tối ưu khoảng cách (gap) và kích thước nút bấm trên mobile | Giảm tỉ lệ bấm nhầm nút xuống dưới 5% trên các thiết bị mobile. |

### Pains NOT addressed in v1 (deliberate — tie to the scope cut list)

- Bảo mật xác thực 2 bước (2FA) local -> Đăng nhập SSO qua Entra ID đã có sẵn MFA của Microsoft, không cần làm ở mức local.
- Thay đổi background theo thời gian trong ngày -> Chưa cần thiết cho phiên bản đầu tiên của giao diện đăng nhập.

## Problem statement

Trang đăng nhập ERP hiện tại thiếu tính thẩm mỹ chuyên nghiệp và gặp lỗi UI/UX nhỏ (tiêu đề dễ nhầm với link, nút bấm quá gần nhau trên mobile), làm giảm trải nghiệm ban đầu của nhân viên khi bắt đầu ngày làm việc.

## Features (user-centric — action → observable result)

Tag each v1 feature with a stable id `FRn:` (functional requirement) — the traceability
anchor. Every `FRn` must later be claimed by a card (`implements: FRn`) and served by an
interface in the contract (`FRn →`); `/flow consistency` checks this mechanically.

- FR1: Khi người dùng xem trang đăng nhập, tiêu đề hiển thị dưới dạng text tĩnh có màu xám tối/đen (`--cmc-text`), không có gạch chân hay đổi màu hover như link.
- FR2: Khi người dùng truy cập, background của trang là một dải gradient tối sang trọng, form đăng nhập dạng Paper được áp dụng hiệu ứng Glassmorphism (nền mờ, viền mỏng và đổ bóng nhẹ) và hiển thị logo CMC màu trắng nổi bật phía trên.
- FR3: Khi hiển thị trên thiết bị mobile, khoảng cách (gap) giữa nút "Đăng nhập" truyền thống và nút SSO Microsoft tự động giãn rộng (tối thiểu 16px), các nút có kích thước tối thiểu 44px chiều cao để dễ dàng bấm chạm.

## Non-functional requirements

- Mobile-responsive: Layout tự động thích ứng hoàn hảo trên màn hình có chiều rộng từ 320px đến 4K.
- Performance: Thời gian tải trang đăng nhập ERP dưới 1.5 giây trên mạng di động 3G/4G tiêu chuẩn.
- Accessibility (A11y): Đảm bảo độ tương phản màu sắc giữa text và nền tối thiểu 4.5:1.

## Tech stack

- Frontend: React 18, `@mantine/core` v7.
- Styling: Vanilla CSS kết hợp các CSS variables từ [tokens.css](file:///d:/project/CMCnew/packages/ui/src/tokens.css).
- Backend APIs: tRPC client (giữ nguyên kết nối tới `trpc.auth.login` và `trpc.auth.me`).

## Success metric (numbers only)

- 100% nhân viên phản hồi giao diện mới đẹp và chuyên nghiệp hơn giao diện cũ (khảo sát nội bộ 15 nhân viên thử nghiệm).
- Tỉ lệ click nhầm nút trên mobile đạt 0% (trong 50 lượt thử nghiệm bấm chạm trên thiết bị mobile).
- Tốc độ load trang login đạt < 1.0 giây trên local host và < 1.5 giây trên môi trường staging.
