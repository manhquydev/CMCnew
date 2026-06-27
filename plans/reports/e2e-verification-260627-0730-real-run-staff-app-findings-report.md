# Rà soát chạy thật (E2E) — ERP staff app sau F0–F4

Ngày: 2026-06-27 · Nhánh: feature/erp-unify-rbac-f0 · Mode: real-run verification (Playwright + curl)

## Mục tiêu
Verify "tính thực tế": app có **thực sự boot + đăng nhập + render** không, không chỉ pass integration test. Chạy Playwright E2E (tự boot api+admin+teaching+lms) + curl trực tiếp endpoint auth.

## Phát hiện thật (mỗi cái đều là bug/gap thực, integration test không bắt được)

### 1. [BUG dev-config] Đăng nhập staff hỏng trên HTTP local — cookie Secure
- Triệu chứng: E2E login form hiện ra nhưng login→dashboard **không bao giờ vào** (session không dính).
- Root cause: `.env` **không có `COOKIE_SECURE`** → `auth.ts`/`index.ts` set cookie `Secure=true` → trên `http://localhost` browser **loại cookie** → app không dùng được ở local dev (khi chưa có SSO secret R6).
- Verify bằng curl: fresh api (COOKIE_SECURE=false) → `POST /trpc/auth.login` raw body → **200**, `Set-Cookie: cmc.session=...; HttpOnly; SameSite=Lax` (KHÔNG còn Secure), trả super_admin. Login server-side đúng.
- Fix: set `COOKIE_SECURE=false` trong `.env` dev + document trong `.env.example`.

### 2. [TEST stale] Selector nút login mơ hồ sau R5
- R5 thêm nút SSO "Đăng nhập bằng tài khoản CMC EDU" → `getByRole('button',{name:'Đăng nhập'})` khớp **2 nút** → strict-mode violation → mọi test login staff fail.
- KHÔNG phải product bug (login chạy đúng). Fix: thêm `exact: true` ở 5 spec (admin-smoke, admin-hr-panel, teaching-smoke, teaching-navigation, unified-staff-shell).

### 3. [TEST stale] lms-smoke dùng auth cũ
- PH login đổi sang **Email OTP 2 bước** (R3/R5); test cũ dùng label `'Email hoặc số điện thoại'` + password (không còn). Fix: rewrite — student (code+password) happy/error + parent OTP step-1.

## Việc đã làm
- `.env` (dev, không commit): `COOKIE_SECURE=false`.
- `.env.example`: document `COOKIE_SECURE`.
- E2E: thêm `apps/e2e/tests/unified-staff-shell.spec.ts` (F0B nav gộp + F1 form HS-mới reachable); fix selector 5 spec; rewrite lms-smoke cho OTP/student.
- Seed dev DB (idempotent): super_admin + giao_vien/ke_toan/hr/sale/cskh/ctv_mkt.

## Trạng thái
- curl auth.login: ✅ 200, cookie non-Secure, super_admin.
- Playwright: re-run sau fix (kết quả ghi ở cuối khi xong).

## Còn mở
- R6: IT cấp `ENTRA_CLIENT_SECRET` + `GRAPH_*` để bật SSO/email thật (E2E hiện dùng break-glass password).
- Retire `apps/teaching` sau khi đã gộp vào admin (hiện vẫn build + có E2E riêng).
