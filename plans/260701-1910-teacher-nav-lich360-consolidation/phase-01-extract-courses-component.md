# Phase 01 — Tách Courses() thành component riêng

**Status: DONE** — `apps/admin/src/courses-panel.tsx` tạo mới, `App.tsx` case `'courses'` dùng `CoursesPanel`, build pass.

## Vì sao cần
`Courses()` hiện là hàm nội bộ trong `apps/admin/src/App.tsx:103-197` (~95 dòng), không phải file riêng — không thể `import` vào tab của phase 02.

## Files
- Sửa: `apps/admin/src/App.tsx` (xoá hàm `Courses`, import từ file mới; **giữ nguyên `TermsPanel` tại chỗ** — đã xác nhận qua audit: `TermsPanel` KHÔNG nằm trong thân `Courses()`, nó là sibling trong case `'courses'` ở `renderContent()` dòng 653-666, chỉ render thêm khi `can(..., 'assessment', 'termCreate')`)
- Tạo: `apps/admin/src/courses-panel.tsx` (copy nguyên logic `Courses()` — CHỈ hàm này, không kèm `TermsPanel`)

## Bước làm
1. Đọc `App.tsx:103-197` để lấy nguyên văn logic + props/state dùng (đã audit khớp chính xác dòng 103-197).
2. Tạo `courses-panel.tsx`, export named `CoursesPanel` (đổi tên cho nhất quán với `AssessmentPanel`/`CertificatePanel`), giữ nguyên hành vi/API gọi.
3. Trong `App.tsx` case `'courses'` (dòng 653-666), thay `<Courses />` bằng `<CoursesPanel />` (import từ file mới), **giữ nguyên `<TermsPanel facilityId=... />` đứng sau nó y hệt hiện tại**. Route `/courses` vẫn hoạt động y hệt cho mọi role (không đổi hành vi ở phase này).

## Test
- `pnpm --filter admin build` không lỗi type.
- Vào `/courses` bằng tài khoản bất kỳ role có quyền `open` — giao diện y hệt trước khi tách.

## Rủi ro
Thấp — thuần refactor di chuyển code, không đổi permission/route.
