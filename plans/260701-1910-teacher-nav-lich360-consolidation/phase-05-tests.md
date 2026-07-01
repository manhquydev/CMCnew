# Phase 05 — Cập nhật test

**Status: DONE (unit) / PENDING (e2e chưa chạy)** — `nav-teacher-consolidation.test.ts` tạo mới, gọi thẳng `buildNavGroups()`; viết lại để derive expectation từ `NAV_GATES`/`can()` tại thời điểm chạy test thay vì hardcode role list, vì phát hiện 1 session khác đang sửa `permissions.ts` (RBAC consolidation) đồng thời trong cùng working tree — làm hardcode cứng sẽ fragile. `nav-consistency.test.ts` chỉ sửa `expectedOpen` (thêm 2 key placeholder). Playwright spec `teacher-nav-consolidation.spec.ts` viết xong nhưng CHƯA chạy (không có dev server/DB sống trong phiên này) — acceptance criteria "Playwright teacher-nav spec pass 100%" (plan.md dòng 116) còn treo, cần chạy thủ công trên stack sống.

## Phát hiện quan trọng từ audit (đổi cách làm so với bản đầu)
`nav-consistency.test.ts` hiện tại **KHÔNG bao giờ gọi `buildNavGroups()`** — nó chỉ so khớp `NAV_GATES` (cấu hình gate) với `PERMISSIONS` (registry quyền) theo generic mọi role, không kiểm tra sidebar thực sự render gì cho 1 role cụ thể. Vì vậy:
- `expectedOpen` array (dòng 145) **KHÔNG cần sửa** — 2 section mới không cần đổi `kind` trong `NAV_GATES` (vẫn `open`/`permission` như cũ), chỉ đổi cách `buildNavGroups()` NHÓM chúng lại theo role. Bản kế hoạch đầu tiên nói cần sửa `expectedOpen` là SAI, đã audit lại.
- Muốn test "giáo viên thấy 3 mục mới, không thấy 5 mục cũ riêng lẻ" phải viết **test suite MỚI gọi trực tiếp `buildNavGroups({roles, isSuperAdmin})`** — đây là cơ chế hoàn toàn khác, không mở rộng được từ assertion hiện có.

## Files
- Tạo: `apps/admin/src/__tests__/nav-consistency.test.ts` — GIỮ NGUYÊN các assertion cũ (vẫn đúng, không cần sửa).
- Tạo mới: `apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` (file riêng, không nhồi vào file cũ):
  - Gọi `buildNavGroups({roles: ['giao_vien'], isSuperAdmin: false})` → assert xuất hiện `student-mgmt`/`payroll-checkin`, KHÔNG xuất hiện `classes`/`courses`/`assessment`/`my-payslips`/`checkin` như mục riêng.
  - Gọi lại với `roles: ['giao_vien', 'head_teacher']` (đa vai trò) → assert vẫn hiện đủ theo logic đã chốt (không được vô tình áp gộp lên head_teacher nếu tài khoản có 2 role — cần quyết định hành vi này khi code, khuyến nghị: chỉ gộp khi role DUY NHẤT là giao_vien).
  - Gọi với `roles: ['giam_doc_dao_tao']`, `roles: ['giam_doc_kinh_doanh']`, `roles: ['head_teacher']`, `roles: ['quan_ly']` → assert output **giống hệt trước khi đổi** (regression guard, chống rò rỉ gộp sang role khác — quan trọng vì `assessment.termList` cũng cấp cho `head_teacher`/`quan_ly`).
- Tạo: `apps/e2e/tests/teacher-nav-consolidation.spec.ts` — theo mẫu `unified-staff-shell.spec.ts` (login qua `getByLabel('Email')`/`getByLabel('Mật khẩu')`, chọn nav bằng `page.locator('nav a').filter({hasText: label})`): đăng nhập `giao_vien`, assert 3 mục nav mới hiện, assert từng tab ẩn khi thu hồi quyền tương ứng.

## Test chạy
- `pnpm --filter admin test` (vitest) — pass 100%, bao gồm file test mới.
- `pnpm --filter e2e test teacher-nav-consolidation` — pass.

## Rủi ro
Thấp — thuần viết test, nhưng LÀ gate bắt buộc trước finalize theo HARD-GATE-NO-SIDE-EFFECTS của /cook. Điểm dễ sai nhất: quên test đa-vai-trò (`giao_vien` + role khác cùng lúc) — đây là edge case audit mới phát hiện, không có trong bản kế hoạch đầu.
