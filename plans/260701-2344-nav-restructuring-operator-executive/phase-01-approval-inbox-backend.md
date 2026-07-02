# Phase 1 — Backend: approval-inbox aggregate

## Context links
Parent: `plan.md`. Scout: agent Explore `ae8d4d0921cd1a4af` (2026-07-01, tóm tắt trong plan.md
mục "Phát hiện thật" #4-5). Không phụ thuộc phase khác.

## Overview
- Priority: P1 (chặn Phase 3 + 4) | Status: done
- Mục tiêu: 1 procedure `dashboard.myApprovals` trả về danh sách "chờ tôi duyệt" role-aware,
  tái dùng 4 query đã có, viết mới 3 query còn thiếu.

## Requirements

### Query đã có sẵn — chỉ tái dùng, KHÔNG viết lại
| Domain | Query | File:line |
|---|---|---|
| Level progress (chỉ GĐĐT) | `levelProgress.listPending` | `apps/api/src/routers/level-progress.ts:52-68` |
| Shift registration (cả 2 GĐ, lọc theo nhóm ca) | `shiftRegistration.list({status:'submitted'})` | `apps/api/src/routers/shift-registration.ts:107-109` |
| Manual punch (cả 2 GĐ, scope theo direct reports) | `checkInOut.pendingManual` | `apps/api/src/routers/check-in-out.ts:195-220` |
| Rewards (chỉ GĐKD) | `rewards.pendingList` | `apps/api/src/routers/rewards.ts:111-130` |

### Query MỚI cần viết
1. **KPI pending-confirm/approve** (`apps/api/src/routers/payroll.ts`) — cả 2 GĐ.
   - Model thật là **`KpiScore`** (KHÔNG phải "KpiEval" — đã verify trong `schema.prisma:1362-1384`),
     enum `KpiStatus` (`schema.prisma:1353-1358`): `draft|submitted|confirmed|approved`. Fields:
     `submittedById/submittedAt`, `confirmedById/confirmedAt`, `approvedById/approvedAt`.
   - "Chờ xác nhận" = `status:'submitted'`. "Chờ duyệt" = `status:'confirmed' AND confirmedById != caller.userId`
     (separation-of-duty — đúng invariant đã có ở `payroll.ts:848` comment: "own sheet — otherwise
     a manager who also holds kpiEvalConfirm could rubber-stamp themselves").
   - Procedure có sẵn để tham chiếu pattern RLS/facility-scope: `kpiEvalConfirm` (`:833`),
     `kpiEvalApprove` (`:870`), `kpiEvalGet` (`:922`), `kpiList` (`:941`).
2. **Receipt pending-approval** (`apps/api/src/routers/finance.ts`) — chỉ GĐKD (cùng `ke_toan`).
   - `ReceiptStatus` enum (`packages/db/prisma/schema.prisma:941-947`): `draft|approved|sent|reconciled|cancelled`.
   - "Chờ duyệt" = `status:'draft'`. Xác nhận lại bằng cách đọc `finance.ts:272` (`receiptApprove`
     handler) — trạng thái input mong đợi trước khi approve.

### Procedure mới: `dashboard.myApprovals`
- Router: `apps/api/src/routers/dashboard.ts` (cạnh `summary`, KHÔNG sửa `summary`).
- Gate: `PERMISSIONS.dashboard.myApprovals = ['giam_doc_kinh_doanh', 'giam_doc_dao_tao']`
  (đăng ký trong `packages/auth/src/permissions.ts`, cạnh dòng 61-63).
- Input: `{facilityId}`.
- Output: mảng item `{domain, id, title, submittedAt, actionKey}` — role-aware:
  - GĐKD: receipt-pending + rewards-pending + shift-reg(KINH_DOANH) + kpi-pending + manual-punch.
  - GĐĐT: level-progress-pending + shift-reg(DAO_TAO) + kpi-pending + manual-punch.
- Chạy `Promise.all` song song các sub-query theo role của caller (giống pattern `dashboard.summary`,
  `dashboard.ts:10-25`), RLS-scoped qua `withRls`/facility đã có sẵn trong context — không tự viết
  RLS mới.

## Architecture
Không đổi schema, không migration. Chỉ thêm 1 procedure + 3 query con (2 trong `payroll.ts`,
1 trong `finance.ts`) + 1 dòng registry trong `permissions.ts`.

## Related code files
- `apps/api/src/routers/dashboard.ts` (thêm `myApprovals`)
- `apps/api/src/routers/payroll.ts` (thêm 2 query pending KPI)
- `apps/api/src/routers/finance.ts` (thêm 1 query pending receipt)
- `packages/auth/src/permissions.ts` (đăng ký gate mới)

## Implementation Steps
1. Đọc `KpiScore` model (`schema.prisma:1362-1384`) + `payroll.ts:833-870` context trước khi code
   (field name đã xác nhận ở Requirements, không cần đoán lại).
2. Viết 2 query KPI pending (confirm/approve) trong `payroll.ts`, tái dùng pattern RLS/facility
   scope đã có trong file.
3. Viết 1 query receipt pending (`status:'draft'`) trong `finance.ts`.
4. Đăng ký `PERMISSIONS.dashboard.myApprovals` trong `permissions.ts`.
5. Viết `dashboard.myApprovals` — role-branch theo `ctx.session.roles`, gọi song song các query
   theo role, gộp thành 1 mảng chuẩn hoá.
6. Không đổi `dashboard.summary` — verify bằng cách diff file, đảm bảo 0 dòng thay đổi trong hàm đó.

## Todo list
- [x] Đọc KpiScore schema + payroll.ts separation-of-duty logic thật (verified khi viết plan)
- [x] 2 query KPI pending mới (payroll.ts)
- [x] 1 query receipt pending mới (finance.ts)
- [x] Đăng ký gate `dashboard.myApprovals` (permissions.ts)
- [x] Procedure `dashboard.myApprovals` (dashboard.ts) — role-aware, Promise.all
- [x] `dashboard.summary` không đổi (diff-verify)
- [x] Integration test: mỗi domain trả đúng item khi có data pending, rỗng khi không
- [x] Integration test: separation-of-duty — director vừa confirm không thấy sheet đó ở "chờ duyệt"

## Success Criteria
`dashboard.myApprovals` trả đúng item cho cả 2 role, không lộ item của domain không thuộc
quyền, test integration xanh, `dashboard.summary` không đổi 1 dòng.

## Risk Assessment
Risk thấp — chỉ thêm read-only aggregate, không mutation mới, không đổi contract cũ. Rủi ro
chính: quên separation-of-duty filter → lộ khả năng tự duyệt (đã có invariant ở tầng mutation
`kpiEvalApprove`, nhưng nếu inbox không lọc đúng UX sẽ gây nhầm lẫn, không phải lỗ hổng bảo mật
thật vì mutation vẫn chặn).

## Next steps
Sau khi xanh: Phase 3 + Phase 4 dùng `dashboard.myApprovals` làm nguồn dữ liệu hộp duyệt.
