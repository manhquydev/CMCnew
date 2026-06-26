# Phase 03 — KPI System: Callio auto + manual override + audit log

**Risk:** HIGH (payroll input, authorization, audit) | **Depends:** Phase 01

## Decision (Q2)

KPI tự động tính từ Callio (cuộc gọi >5s cho sale/CSKH) **nhưng** con người có quyền sửa cuối cùng (role-gated), mọi lần sửa ghi audit log minh bạch kiểu Odoo (ai sửa, từ giá trị nào → giá trị nào, lý do, khi nào). Auto là mặc định, override là quyết định cuối.

## Current State (từ review)

- `apps/admin/src/kpi-evaluation-panel.tsx:50` gọi 7 procedures qua type-cast `(trpc.payroll as unknown as {...})` — KHÔNG tồn tại → crash runtime (C2).
- Infra đã build nhưng chưa wire: `apps/api/src/lib/callio-client.ts`, `apps/api/src/lib/kpi-authz.ts`, `packages/domain-payroll/src/kpi.ts`.
- Harness stories PAY-KPI-* đã đánh "implemented" nhưng router thực tế thiếu → cần đối chiếu thực trạng `payroll.ts`.

## Requirements

### 1. KPI router (`apps/api/src/routers/kpi.ts` — mới)
7 procedures admin panel cần: `kpiList`, `kpiEvalStart`, `kpiAutoPrefill`, `kpiEvalSubmit`, `kpiEvalConfirm`, `kpiEvalApprove`, `kpiEvalGet`. Mount vào `routers/index.ts`.
- `kpiAutoPrefill`: gọi `callio-client.fetchPeriodCdrs` → `domain-payroll/kpi.weightedKpi` → lưu KpiScore record (auto source).
- `kpiEvalSubmit/override`: cho phép sửa điểm, guard bằng `kpi-authz.canOverrideKpi` (tree-based manager, chặn self-override), bắt buộc `reason`.
- Mỗi override → `logEvent` audit (oldScore→newScore, by, reason, periodKey).
- `payslipCompute` đọc điểm đã lock từ KpiScore record thay vì free-form `input.kpiScore` (giữ backward-compat: nếu chưa có record + role cho phép → cho nhập tay, vẫn log).

### 2. Schema
- `KpiScore`/`KpiEvaluation` table nếu chưa có: periodKey, userId, facilityId, autoScore, finalScore, source(auto|manual), criteria JSON, status(draft|submitted|confirmed|approved), audit fields. Đối chiếu schema hiện tại trước khi tạo mới (tránh trùng).

### 3. Admin panel
- `apps/admin/src/kpi-evaluation-panel.tsx`: bỏ type-cast, dùng `trpc.kpi.*` typed; sửa `kpiEvalSubmit` truyền đúng `userId` của row (review H: hiện submit theo session user); hiển thị auto vs final, nút override với ô lý do, lịch sử audit (Chatter).

### 4. Callio config
- Env: `CALLIO_API_TOKEN`, `CALLIO_BASE_URL`. Startup: nếu thiếu token → `kpiAutoPrefill` no-op + cảnh báo, KHÔNG crash (theo story PAY-CALLIO-CALLS pattern).

## Validation

- Int-test `apps/api/test/kpi-eval-workflow.int.test.ts`: auto prefill từ CDR giả → submit → manager override (log old→new+reason) → self-override FORBIDDEN → approve → payslipCompute đọc finalScore.
- Admin typecheck green; panel không còn type-cast.
- Live: panel render, override ghi audit, payslip dùng điểm đã duyệt.

## Risks / Rollback

- Nếu schema KPI đã tồn tại một phần → đối chiếu kỹ, không tạo bảng trùng.
- Callio token chưa có ở dev → auto path no-op, manual vẫn chạy.
- Đây là hard-gate (auth+payroll+audit) → cần code-reviewer + có thể hỏi user nếu schema đụng quyết định cũ.
