# Stage 02 — Scope (go/no-go)

Scope = features chosen by IMPACT × COST, inside your time budget.
KILL here is cheap and smart. Killing a weak idea at this gate is a SUCCESS outcome.

## Impact rubric (business value — score BEFORE looking at cost)

| Impact | Meaning |
|---|---|
| H | moves money or the core promise: gets users in (acquisition), gets them paying (revenue), or delivers the one job they came for |
| M | keeps users / saves real time weekly (retention, operations) |
| L | nice-to-have; nobody would pay for or switch over it |

Decision matrix: **H-impact features justify B/C cost** (via the C-paths below).
**L-impact features must be grade A or they're cut** — and even grade-A L-features are
cut when the budget is tight. The classic failure is a v1 full of A-grade L-impact
features: cheap to build, worthless to sell.

## AI coding grade rubric

| Grade | Meaning | Examples |
|---|---|---|
| A | cheap for AI | CRUD, forms, dashboards, content sites, API wrappers |
| B | moderate | file processing, 3rd-party integrations, auth via library, single LLM call, HITL AI drafts |
| C | expensive | realtime, payments from scratch, custom auth, autonomous agentic AI pipelines, heavy concurrency |

**Grade is a COST estimate, not a permission.** The gate is fit(grades, budget), not "no C allowed."
When a C feature is the real need, three honest paths:
1. **The C feature IS the product** → invert the cut: C goes FIRST (riskiest assumption first),
   everything else is minimized to serve it, and the budget is renegotiated against reality.
   But: one C proves the value prop — its siblings are v2 cards, not v1 scope.
2. **Re-architect C down to B** (highest-leverage move): multi-step agent → single LLM call;
   auto-send → human-approves-draft; custom pipeline → managed service / library.
   Same user value, one grade cheaper.
3. **Irreducible C that doesn't fit the budget** → KILL or re-budget. Both are honest.

## Gate — check ALL before `/flow next`
- [x] Every feature below has an IMPACT (H/M/L with the business reason) AND a grade (A/B/C)
- [x] No L-impact feature above grade A survives in v1
- [x] The suggested-features section was actually considered (each suggestion has an in/out decision)
- [x] fit(grades, budget) holds — every C in scope is justified as path 1, 2, or 3 above (written next to the feature)
- [x] If the product IS a C feature: it is FIRST in build order, and its sibling C features are on the cut list
- [x] The cut list is written (what I am NOT building in v1)
- [x] GO / KILL decision is written below
- [x] No FILL placeholders remain in this file

## Time budget

3 hours.

## Features in v1 (each with impact AND grade)

- Tái cấu trúc tiêu đề: Thay đổi chữ "CMC · Admin" thành chữ tĩnh, dùng màu tối sang trọng, không dùng `--cmc-brand` xanh dương để tránh nhầm lẫn là link liên kết. (Impact: M - cải thiện tính rõ ràng và đúng chuẩn UI/UX — Grade: A — Sửa TSX đơn giản).
- Background layout mới cho trang login ERP: Thiết kế nền gradient tối kết hợp tinh tế với các đường nét branding của CMC, mang lại cảm giác chuyên nghiệp cao cấp thay vì nền trắng trơn. (Impact: M - nâng cao trải nghiệm DX/Employee Experience — Grade: A — CSS/Styled Components).
- Cải thiện spacing và kích thước các nút đăng nhập: Tăng khoảng cách (gap) giữa nút "Đăng nhập" truyền thống và nút Microsoft SSO để tránh bấm nhầm trên màn hình cảm ứng di động. (Impact: M - tăng tính khả dụng trên mobile — Grade: A — layout spacing).

## Suggested features (impact-first — proposed, not decided)

- Thêm hiệu ứng Glassmorphism cho khung đăng nhập (Paper): (Impact: L - nâng tầm thẩm mỹ hiện đại — Grade: A — IN: Cần thiết để wow người dùng ngay cái nhìn đầu tiên và rất rẻ để thực hiện).
- Micro-interactions cho input: Thêm hiệu ứng chuyển động mượt mà khi người dùng tương tác với input. (Impact: L - trải nghiệm tinh tế — Grade: A — IN: Tận dụng các style focus sẵn có của Mantine).

## Cut list (NOT in v1 — deferred, not deleted)

- Tự xây dựng xác thực 2 bước (2FA): Đã có SSO của Microsoft xử lý, không cần làm ở mức local. (Lý do hoãn: Phức tạp cấp độ C, tốn nhiều thời gian và không cần thiết lúc này).
- Tự động thay đổi background theo thời gian thực (ngày/đêm): (Lý do hoãn: Grade B, không ảnh hưởng nhiều tới chức năng cốt lõi).

## Decision

GO — Chi phí phát triển cực kỳ thấp (toàn bộ là Grade A), thời gian nhanh chóng, giúp giải quyết triệt để vấn đề thẩm mỹ nghèo nàn của trang ERP Login hiện tại.
