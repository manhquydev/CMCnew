# F0 — RBAC registry tập trung + gộp shell staff

Rủi ro: TB (đụng authorization). Phụ thuộc: không. Mở đường cho F1, F3.

## Context
- `plans/reports/architecture-260626-2338-unified-erp-rbac-report.md`
- `plans/reports/decision-260626-2338-rbac-model-recommendation-report.md`
- `plans/reports/spec-audit-260626-2338-teacher-permissions-report.md`

## Nền auth đã có (KHÔNG làm lại)
Staff login đã là **Microsoft SSO/OIDC** (`apps/api/src/lib/sso.ts`, `routers/auth.ts`, `mintStaffSession`). F0 chỉ **đọc `ctx.session.roles`** (DB AppUser) để enforce registry; KHÔNG đụng luồng SSO/OTP/Graph. super_admin break-glass password vẫn giữ → khớp với "super_admin bypass" của registry.

## Requirements
1. **Permission registry tập trung** (explicit per-role, không kế thừa): `module → action → Role[]`. super_admin giữ bypass ngầm.
2. Thay ~97 điểm `requireRole` rải rác bằng tra cứu registry (1 nguồn sự thật). Backend là nơi enforce; frontend chỉ đọc registry để ẩn/hiện nav + nút.
3. **Gộp `apps/admin` + `apps/teaching` → 1 SPA `StaffShell`** nav lọc theo role; gỡ panel trùng (crm/cskh/finance/payroll đang là file trùng giữa 2 frontend). LMS (apps/lms) không đụng.
4. **Persona → màn landing** (teacher→Lịch dạy, sale→CRM, ke_toan→Finance, quan_ly→dashboard).
5. Áp quyết định đã khóa vào registry: tạo lớp/xếp lịch = quan_ly+head_teacher (DIFF có chủ đích so với code chỉ-quan_ly hiện tại — flag trong parity test). head_teacher không verb dạy. ctv_mkt = CRM lead O1 đọc/tạo.

## Files (dự kiến — xác nhận khi vào việc)
- Tạo: `packages/auth/src/permissions.ts` (registry + helper `can(role, module, action)`).
- Sửa: `apps/api/src/trpc.ts` (`requireRole` → `requirePermission`), các router `apps/api/src/routers/*.ts`.
- Tạo/gộp: `apps/admin` ↔ `apps/teaching` → 1 app (chọn host app — xem mở dưới); `packages/ui` StaffShell + nav config.
- Sửa: schema `Role` enum nếu cần (`packages/db/prisma/schema.prisma:15`) cho ctv_mkt.

## Steps
1. Trích registry từ ma trận de-facto trong architecture report (giữ NGUYÊN quyền hiện có, trừ các DIFF đã khóa).
2. Viết parity test: với mỗi procedure, quyền sau-refactor == trước-refactor, NGOẠI TRỪ các DIFF khóa (tạo lớp +head_teacher, ctv_mkt +CRM lead).
3. Refactor backend sang registry; chạy parity test xanh.
4. Dựng StaffShell + nav lọc role; di trú panel từ 2 frontend, xoá bản trùng.
5. Persona→landing; smoke mỗi role.

## Validation
- Parity test xanh (diff đúng bằng tập DIFF khóa, không thừa/thiếu).
- Login từng role → chỉ thấy đúng module; route cấm trả 403.
- build + typecheck xanh.

## Risks / Rollback
- Refactor auth dễ mis-grant → parity test là chốt chặn. Giữ commit nhỏ theo router.
- JWT tokenVersion: đổi role không phá session đang chạy ngoài ý muốn.

## Quyết định cấu trúc (đã chốt 2026-06-27)
- **Host app = `apps/admin`** làm gốc. Hút 9 panel vận hành từ `apps/teaching` (grading, assessment, attendance, attendance-roster, schedule, meetings, level-approval, certificate, my-payslips). Dedupe 4 panel trùng (finance/payroll/crm/cskh) — giữ 1 bản chuẩn. Đổi tên thư mục `apps/admin`→staff để sau (cosmetic).
- Thứ tự build F0: **Part A backend registry (host-independent) TRƯỚC** → parity test xanh → **Part B frontend consolidation**.

## Còn mở (không chặn)
- Topology serve prod (chưa thấy nginx/compose mapping trong repo) — xử lý khi deploy.
