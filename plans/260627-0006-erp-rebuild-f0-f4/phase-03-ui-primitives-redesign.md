# F3 — UI primitives packages/ui + redesign màn + /design

Rủi ro: Thấp (additive). Phụ thuộc: F0 (StaffShell). Song song được với F1.

## Context
- `plans/reports/ui-audit-260626-2338-unified-erp-redesign-direction-report.md`

## Tiền đề (đã xác minh)
Token/theme `packages/ui` đã chuyên nghiệp — lỗi ở compose màn (dùng ~30% canvas, empty state trơ, KPI card phẳng, list 233 dòng không lọc). KHÔNG đổi token màu. Additive.

## Requirements
1. Thêm ~8 primitive vào `packages/ui`: `EmptyState`, `StatCard`, `DataTable` (lọc/sort/phân trang/empty/loading), `PageHeader`, `StatusBadge`, + 3 cái report đề xuất.
2. Áp dụng cho màn trọng điểm: Dashboard, class-detail/scheduling, list Students, CRM pipeline.
3. Chạy `/design` với IA thống nhất (nav taxonomy + persona→landing) làm input để ra design cụ thể trước khi code màn.
4. Rollout 4 pha additive — không big-bang; màn chưa đổi vẫn chạy.

## Files (dự kiến)
- `packages/ui/src/*` (primitive mới + export).
- Màn: `apps/<staff>/src/*-panel.tsx` áp primitive dần.

## Steps
1. `/design`: chốt design language cụ thể (palette/typography/spacing/table/sidebar) dựa trên token sẵn có + 8 primitive.
2. Implement primitive + story/preview.
3. Refactor màn trọng điểm sang primitive (mỗi màn 1 commit nhỏ).
4. Đo: mật độ thông tin, empty/loading state có mặt, nav lọc role đúng.

## Validation
- Primitive có empty + loading + error state.
- Màn refactor không hồi quy chức năng; build + typecheck xanh.
- A11y cơ bản (focus, contrast) theo web-design-guidelines.

## Risks / Rollback
- Áp dần nên rủi ro thấp; nếu primitive lệch, khoanh trong packages/ui không lan.
