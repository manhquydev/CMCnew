# GĐ onboarding + KPI authority + SSO verification

Status: DONE — 2026-06-27 (324 int + 38 unit tests pass; live E2E: 2 GĐ tạo qua UI, GĐ ĐT mở panel KPI OK; code review DONE_WITH_CONCERNS, L2 ADMIN_APP_ORIGIN fixed)
Branch: develop · Lane: high-risk (authorization + public contract + external email)

## Bối cảnh đã verify (không sửa đổi)
- Auth model ĐÚNG như user nhớ: `admin@cmcvn.edu.vn` (super_admin) login cả SSO + password (break-glass); role khác chỉ SSO khi `SSO_ENABLED=true`. (`auth.ts:31-36`, `index.ts` `login`)
- SSO chỉ đọc email+tenant từ id_token; vai trò sống trong AppUser, decoupled (`sso.ts`, `mintStaffSession`). Graph client chỉ `sendMail`, không tạo MS user.
- Quyết định onboarding: Pattern (b) thủ công M365 + ERP gửi welcome email SSO (no password). Auto-provision DEFERRED → memory `ms-account-provisioning-decision`.
- 2 GĐ tạo qua UI super_admin (KHÔNG đổi seed).

## Gaps thật phát hiện
1. KPI: 2 GĐ không có quyền `kpiList/kpiEvalGet/kpiEvalConfirm/kpiEvalApprove`. Prod bootstrap không seed `bgd` → hiện KHÔNG ai duyệt KPI được. (`permissions.ts`, `payroll.ts`)
2. UI tạo user: `App.tsx` ROLES hardcode 10 vai trò, THIẾU 2 director role → super_admin không chọn được khi tạo GĐ. Lệch registry.
3. KPI nav gate = `kpiList` (hr/ke_toan) → GĐ không thấy panel KPI.

## Phạm vi (acceptance)
- super_admin tạo được nhungdt@→GĐ KD, hongltn@→GĐ ĐT qua UI (dropdown có director role, derive từ `assignableRoles`).
- GĐ KD: thấy + xác nhận/duyệt KPI; tạo team sale/cskh/ctv_mkt; xem CRM/finance(read)/dashboard. GĐ ĐT: KPI + tạo team giao_vien/head_teacher + course/class/grade/dashboard.
- Tạo user → enqueue welcome email (no password, hướng dẫn SSO).
- SoD KPI giữ nguyên (approver ≠ confirmer).
- Không vỡ test hiện có; parity test xanh.

## Ngoài phạm vi
- ERP auto-provision MS account qua Graph (DEFERRED).
- Domain-scoping cứng KPI theo team (v1 dùng facility-RLS + SoD; ghi chú refine sau).
- Đổi seed prod.

## Thay đổi
Backend:
- `packages/auth/src/permissions.ts`: thêm 2 GĐ vào payroll.{kpiList,kpiEvalGet,kpiEvalConfirm,kpiEvalApprove}.
- `apps/api/src/services/email-templates.ts`: thêm kind `account_welcome` {displayName, loginUrl, roleLabel?}.
- `apps/api/src/routers/user.ts`: post-commit best-effort welcome email khi create.
Frontend:
- `apps/admin/src/App.tsx`: ROLES động từ `assignableRoles(me)` (import `@cmc/auth/permissions`); truyền vào Create/Edit modal.
Tests:
- `apps/api/test/*`: integration GĐ create+KPI confirm/approve + welcome email enqueued; chạy parity + suite.
- E2E Playwright: login GĐ (password local) → tạo NV → dashboard → KPI confirm/approve, screenshot + log API.
Docs:
- `docs/huong-dan-su-dung-giam-doc.md` (GĐ KD + ĐT).
- `docs/huong-dan-su-dung-sale-giao-vien.md`.

## Verify
- `pnpm --filter @cmc/api test` (parity + new int).
- Live: docker prod-like stack, đăng nhập 2 GĐ, bấm nút thật, check server log + screenshot.
- gitnexus detect_changes trước commit.

## Rủi ro / rollback
- Authorization mở rộng (GĐ→KPI): theo đúng quyết định user (3-heads = ban giám đốc). Rollback = revert permissions diff.
- Welcome email: best-effort, try/catch, không rollback create (mirror emailSecurityAlert).
