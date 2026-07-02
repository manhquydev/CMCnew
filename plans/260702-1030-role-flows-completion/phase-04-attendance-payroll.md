# Phase 4 — Attendance→payroll: penalty deduction + monthlyReport + history UI + shift fixes + delegated approver

## Context links
- Brainstorm §2 Mạch tiền/người, D1/D5/D6; plan.md serialization (permissions.ts edit #2, AFTER P3).
- Anchors: `apps/api/src/routers/check-in-out.ts:175-182` (penalty 500đ/min late + 1000đ/min early; VN UTC+7 helpers :20-36); `:250` history (works), `:258-267` manager-scoped; `permissions.ts:277` checkInOut.monthlyReport (granted, procedure DEAD); `apps/api/src/routers/payroll.ts` payslipCompute (~:433) + payslipOverrideVariablePay; `apps/api/src/routers/shift-registration.ts:328-336` (notif only managerId), `:86-101` assertAssignedApprover, `:17-58` manager resolve; `permissions.ts:259` withdraw (perm EXISTS — UI button missing), `:260-261` approve/reject (2 directors only); `apps/admin/src/shift-reg-detail-panel.tsx`.

## Overview
Turn display-only attendance penalties into real payslip deductions (director-overridable), implement the dead monthlyReport procedure + UI, add punch-history UI (self + manager), add the withdraw button, fix shift notifications, and open shift approve/reject to assigned managers.

## Key Insights
- Penalty math ALREADY computed per-punch (`check-in-out.ts:175-182`) but payslipCompute never references it → the gap is aggregation + a deduction line, not new math. Reuse the existing per-minute rates; do NOT re-derive.
- Override must reuse existing `payslipOverrideVariablePay`-style mechanism (D1: director miễn/giảm before finalize); finalize locks the number. Do not build a parallel override path.
- `monthlyReport` perm is live but dead (no procedure) — a real dead-permission. Add the procedure + UI; aggregate month punches per staff (workdays, late/early minutes, penalty total) with per-person drill-down reusing `history` (`:250`).
- `withdraw` PERM already exists (`:259`) — gap is purely a missing UI button in shift-reg-detail-panel. Do not touch permissions for withdraw.
- Delegated approver (D5): open `shiftRegistration.approve/reject` module perm to staff roles, then RELY on existing `assertAssignedApprover` (`:86-101`) to restrict to the packet's assigned managerId AND block self-approve. Directors keep blanket approve via role. This is the permissions.ts edit — the handler guard already enforces the narrowing.
- Notif bug (`:328-336`): notifies only managerId; must also notify `nextManagerId`, and when managerId is null emit a warning/fallback (currently silent → no approver notified).

## Requirements
- payslipCompute: aggregate month's late/early penalty into a distinct deduction line with breakdown; overridable pre-finalize; finalize locks.
- New `checkInOut.monthlyReport` procedure (perm exists) + director/HR UI panel: per-facility staff workdays/late/early/penalty + drill-down.
- Punch history UI: self view + manager-scoped view (reuse `:250`/`:258-267`).
- Withdraw button in shift-reg-detail-panel (perm exists).
- Notif fix: notify managerId + nextManagerId; warn when managerId null.
- `permissions.ts:260-261` approve/reject += staff roles (giao_vien/sale/cskh); rely on assertAssignedApprover.

## Architecture
- Data in: CheckInOut punches (month) + shift assignments → payslipCompute aggregation.
- Data out: payslip with penalty deduction line (override-adjustable) → finalize locks; monthlyReport read model; shift approve reachable by assigned manager.
- Money boundary: penalty aggregation must be deterministic + reproducible for a finalized period (freeze like other payslip inputs); override recorded with actor + reason.

## Related code files
- `apps/api/src/routers/payroll.ts` (~:433 payslipCompute + override) — modify.
- `apps/api/src/routers/check-in-out.ts:175-182,250,258-267` — modify (add monthlyReport proc; reuse penalty calc + history).
- `apps/api/src/routers/shift-registration.ts:328-336` — modify (notif).
- `packages/auth/src/permissions.ts:260-261` — modify (SERIALIZE edit #2, after P3).
- `apps/admin/src/shift-reg-detail-panel.tsx` — modify (withdraw button).
- new monthlyReport + history UI panels — create.

## Implementation Steps
1. permissions.ts: approve/reject += giao_vien/sale/cskh (serialized #2). Verify assertAssignedApprover blocks non-assigned + self.
2. payslipCompute: sum month penalties per staff → deduction line + breakdown; wire override (reuse existing override proc pattern); ensure finalize freezes.
3. Implement checkInOut.monthlyReport procedure (facility-scoped; workdays/late/early/penalty) + UI panel with per-person punch drill-down.
4. Punch-history UI (self + manager-scoped) using existing history endpoints.
5. Withdraw button (shift-reg-detail-panel) calling existing withdraw.
6. Notif fix: add nextManagerId recipient; managerId null → warning event/fallback to director.
7. Tests: penalty deduction matches punch sum; override reduces; finalize locks; delegated approve works, self-approve denied; notif reaches next manager.

## Todo list
- [ ] permissions approve/reject += staff (serialized #2) + verify assigned-approver guard
- [ ] payslipCompute penalty deduction line + override + finalize lock
- [ ] monthlyReport procedure + UI + drill-down
- [ ] punch history UI (self + manager)
- [ ] withdraw button (perm exists)
- [ ] notif nextManagerId + managerId-null warning
- [ ] tests: deduction / override / delegated approve / self-approve deny / notif

## Success Criteria
- §6.2 payslip late/early deduction matches punch total; override works; finalize locks.
- §6.3 monthlyReport shows all facility staff + drill-down.
- §6.5 assigned manager approves own staff's packet; self-approve denied.

## Risk Assessment
- Penalty double-count / wrong month boundary (UTC+7) — Med×High. Reuse `:20-36` ICT helpers; test month-edge punches; freeze on finalize.
- Opening approve/reject perms broadens attack surface — Med×High. assertAssignedApprover is the real gate; add matrix test: staff cannot approve packets not assigned to them, cannot self-approve; director still approves all.
- Override abused to zero-out penalties silently — Low×Med. Require actor+reason audit on override.

## Security Considerations
- Override + penalty changes audited (actor, reason, amount).
- monthlyReport facility-scoped RLS; ke_toan/HR/directors only (perm :277).

## Rollback
- Permission: revert approve/reject role list (snapshot regen); handler guard unaffected.
- payslipCompute: deduction line is additive to compute logic; revert = remove aggregation block (finalized historical payslips already frozen — safe).

## Next steps
- P5 is permissions.ts edit #3 (afterSale) — runs after P4.
