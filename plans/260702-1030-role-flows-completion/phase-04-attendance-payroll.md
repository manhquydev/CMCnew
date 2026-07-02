# Phase 4 — Attendance→payroll: penalty deduction + monthlyReport + history UI + shift fixes + delegated approver

## Context links
- Brainstorm §2 Mạch tiền/người, D1/D5/D6; plan.md serialization (permissions.ts edit #2, AFTER P3).
- Anchors: `apps/api/src/routers/check-in-out.ts:175-182` (penalty 500đ/min late + 1000đ/min early; VN UTC+7 helpers :20-36); `:250` history (works), `:258-267` manager-scoped; `permissions.ts:277` checkInOut.monthlyReport (granted, procedure DEAD); `apps/api/src/routers/payroll.ts` payslipCompute (~:433) + payslipOverrideVariablePay; `apps/api/src/routers/shift-registration.ts:328-336` (notif only managerId), `:86-101` assertAssignedApprover, `:17-58` manager resolve; `permissions.ts:259` withdraw (perm EXISTS — UI button missing), `:260-261` approve/reject (2 directors only); `apps/admin/src/shift-reg-detail-panel.tsx`.

## Overview
Turn display-only attendance penalties into real payslip deductions (director-overridable), implement the dead monthlyReport procedure + UI, add punch-history UI (self + manager), add the withdraw button, fix shift notifications, and open shift approve/reject to assigned managers.

## Key Insights
- Penalty math ALREADY computed per-punch (`check-in-out.ts:175-182`) but neither the domain payslip math nor the router slip-assembler references it. The gap is: (a) a schema home for the amount, (b) aggregation from live punches, (c) a post-tax deduction line. Reuse the existing per-minute rates; do NOT re-derive.
- **Two functions, two jobs (do not conflate):** `assemblePayslip` (`packages/domain-payroll/src/payslip.ts:69-94`) is PURE math (no DB) — currently `netIncome = gross − insurance − PIT`, no deduction input. `assembleSlipData` (router helper, `payroll.ts:110-244`) is the DB-gathering layer that already queries commission auto-feed (`:183-206`) and calls `assemblePayslip`. Penalty aggregation from live punches lives in `assembleSlipData`; the post-tax subtraction lives in `assemblePayslip`.
- **C1 — deduction needs a schema home + tax position.** `Payslip` has NO deduction column (`schema.prisma:1447-1477`). Add ONE additive nullable column `attendanceDeduction Int?` (KISS — no line-item table) + `attendanceDeductionOverride Int?` + `attendanceDeductionOverrideReason String?` + override actor. Penalty is **POST-TAX**: subtract from net AFTER PIT (`netIncome = gross − insurance − PIT − effectiveDeduction`) so it does NOT distort taxable income. Pinned in decision 0025. (Schema+migration owned by P4 — serialized after P1, see plan.md file-ownership.)
- **C2 — self-healing recompute, NOT a variablePay tweak.** `payslipOverrideVariablePay` (`payroll.ts:793-828`) rebuilds the WHOLE slip via `assembleSlipData` (upsert-all at :814ff); `payslipReopen` (`:744`) likewise re-derives from live punches. Therefore the penalty MUST be re-aggregated from live punch data INSIDE `assembleSlipData` on EVERY call — not injected once. Then any variable-pay override or reopen recomputes (not wipes) the penalty. The director "miễn/giảm" control is its OWN field (`attendanceDeductionOverride` + reason), applied on top of the recomputed base — never the `variablePay` mechanism (which is commission). `effectiveDeduction = override ?? aggregatedFromPunches`.
- `monthlyReport` perm is live but dead (no procedure) — a real dead-permission. Add the procedure + UI; aggregate month punches per staff (workdays, late/early minutes, penalty total).
- **M5 — director drill-down must bypass `canViewStaffPunch`.** `canViewStaffPunch` (`check-in-out.ts:42-48`) allows hr / self / direct-managerId only — directors are NOT covered. Once P2 sets `managerId` to a lead, a director drilling into `history` gets FORBIDDEN. Fix: `monthlyReport` performs a SERVER-SIDE facility-scoped aggregate (its own query, gated on `checkInOut.monthlyReport` perm) and does NOT reuse the per-user `history`/`canViewStaffPunch` path. Simpler + avoids widening a punch-detail permission. Drill-down data comes from the same server-side aggregate, not per-user history.
- **M6 — ICT month bucketing.** `periodRange` (`payroll.ts:93-99`) uses UTC boundaries; `history` (`check-in-out.ts:271`) and `registeredInMonth` (`shift-registration.ts:158-159`) too. A 23:xx ICT punch is already next-day UTC → buckets to the wrong month. Payslip period + monthlyReport MUST use ICT (+7) day boundaries: `start = Date.UTC(y, m−1, 1) − 7h`, `end = Date.UTC(y, m, 1) − 7h`. Pick this ONE convention for the payslip period and document it. Also define punch-pairing rules: single-punch day (missing checkout, `todayStatus` gives early=0, :164-181) and >2-punch-day aggregation — currently undefined money math.
- `withdraw` PERM already exists (`:259`) — gap is purely a missing UI button in shift-reg-detail-panel. Do not touch permissions for withdraw.
- **M1 — director blanket-approve is FALSE in code (fix the guard, not the decision).** `assertAssignedApprover` (`:86-101`) checks only managerId/nextManagerId/super_admin — NO director-role bypass. Today directors pass only because `resolveManager` auto-assigns a group director; once P2 sets managerId to a lead, the OTHER director gets FORBIDDEN. Decision 0027 / D5 "2 GĐ duyệt mọi phiếu ca" is the ALREADY-CONFIRMED intent (cited in plan.md success criteria). Fix: add an explicit director-role bypass INSIDE `assertAssignedApprover` (directors approve ANY packet, but keep the anti-self-approve check at :91 above the bypass). Apply the SAME director inclusion to the inbox filters: `shiftRegistrationPendingItems` and `dashboard.ts:84-96` (currently filter by managerId/nextManagerId only → directors' inbox goes empty after P2). D5 decision stands; the guard+filters change to match it.
- Delegated approver (D5): open `shiftRegistration.approve/reject` module perm to staff roles, then RELY on `assertAssignedApprover` to restrict a non-director staff approver to the packet's assigned managerId AND block self-approve; directors bypass via the new role check above.
- Notif bug (`:328-336`): notifies only managerId; must also notify `nextManagerId`, and when managerId is null emit a warning/fallback (currently silent → no approver notified).

## Requirements
- **Schema (C1):** `Payslip` += `attendanceDeduction Int?`, `attendanceDeductionOverride Int?`, `attendanceDeductionOverrideReason String?`, `attendanceDeductionOverrideById String?` (all nullable, additive). Migration owned by P4 (serialized after P1's EmploymentProfile migration).
- **Domain (C1):** `assemblePayslip` (`payslip.ts`) += input `attendanceDeduction` (post-tax); `netIncome = gross − insurance − PIT − attendanceDeduction`; guard non-negative integer. Update `PayslipInput`/`PayslipResult` types + unit tests.
- **Aggregation (C2):** inside `assembleSlipData` (`payroll.ts:110-244`), aggregate the period's late/early penalty from LIVE punch data on every call (beside the commission auto-feed at :183-206); `effectiveDeduction = attendanceDeductionOverride ?? aggregated`; pass to `assemblePayslip`; persist `attendanceDeduction` + breakdown. Recompute-on-override and recompute-on-reopen are automatic because both paths route through `assembleSlipData` — no separate side-channel.
- **Override (C2):** director "miễn/giảm" writes `attendanceDeductionOverride` + reason + actor (its OWN field/proc pattern, NOT `variablePay`). Finalize locks the slip (finalized slips are not re-assembled). Document in 0025: "finalize freezes; reopen re-derives from live punches" (matches N6 — no snapshot store is built).
- **Bucketing (M6):** period + monthlyReport use ICT (+7) day boundaries (`start = UTC(y,m−1,1)−7h`, `end = UTC(y,m,1)−7h`); define single-punch-day and >2-punch-day aggregation rules.
- **monthlyReport (M5):** new `checkInOut.monthlyReport` procedure — SERVER-SIDE facility-scoped aggregate (workdays/late/early/penalty per staff + per-person drill-down from the SAME aggregate), gated on `checkInOut.monthlyReport` perm; does NOT call `canViewStaffPunch`/per-user `history`. Director/HR UI panel.
- Punch history UI: self view + manager-scoped view (reuse `:250`/`:258-267`) — unchanged path, `canViewStaffPunch` still governs it (self/manager/hr).
- Withdraw button in shift-reg-detail-panel (perm exists).
- Notif fix: notify managerId + nextManagerId; warn when managerId null.
- **Approver (M1):** `permissions.ts:260-261` approve/reject += staff roles (giao_vien/sale/cskh); add director-role bypass INSIDE `assertAssignedApprover` (below the anti-self-approve check); apply director inclusion to `shiftRegistrationPendingItems` + `dashboard.ts:84-96` inbox filters so both directors see all packets.

## Architecture
- Data in: CheckInOut punches (ICT month) + shift assignments → `assembleSlipData` aggregates penalty → `assemblePayslip` subtracts post-tax.
- Data out: payslip with post-tax `attendanceDeduction` (override-adjustable, recomputed every assemble) → finalize locks; monthlyReport server-side aggregate; shift approve reachable by assigned manager AND both directors.
- Money boundary: penalty is deterministic given punch data + override; recompute is idempotent; finalize freezes by not re-assembling; override recorded with actor + reason.
- Tax boundary: penalty is POST-TAX — subtracted after PIT, does not change taxable income (decision 0025). Independent of the KPI `tuan_thu` teaching-attendance ratio (`payroll.ts`) and of the confirmed cumulative attendance-transfer blend — no interaction.

## Related code files
- `packages/db/prisma/schema.prisma` (Payslip block ~:1447-1477) + new migration — modify/create (SERIALIZED after P1; P4-owned Payslip columns only, P1 owns EmploymentProfile).
- `packages/domain-payroll/src/payslip.ts:69-94` + its tests — modify (post-tax deduction input).
- `apps/api/src/routers/payroll.ts:93-99,110-244,744,793-828` — modify (ICT periodRange; penalty aggregation in assembleSlipData returning `attendanceDeduction`; the override-variablePay upsert `data` at :808-820 and payslipReopen upsert MUST include `attendanceDeduction: computed.attendanceDeduction` or the recompute is discarded; new override proc).
- `apps/api/src/routers/check-in-out.ts:175-182,42-48` — modify (monthlyReport server-side aggregate proc; reuse penalty calc; do NOT widen canViewStaffPunch).
- `apps/api/src/routers/shift-registration.ts:86-101,328-336` — modify (director bypass in assertAssignedApprover; notif nextManagerId).
- `apps/api/src/routers/dashboard.ts:84-96` — modify (director inclusion in shift approvals inbox filter).
- `packages/auth/src/permissions.ts:260-261` — modify (SERIALIZE edit #2, after P3).
- `apps/admin/src/shift-reg-detail-panel.tsx` — modify (withdraw button).
- new monthlyReport + history UI panels — create.

## Implementation Steps
1. Schema (C1): add Payslip deduction columns + additive migration; 0-drift replay.
2. Domain (C1): `assemblePayslip` post-tax deduction input + tests.
3. Aggregation (C2): penalty aggregation in `assembleSlipData` from live punches (ICT bucketing, M6); `effectiveDeduction = override ?? aggregated`; persist. Verify override-variable-pay and reopen both recompute (not wipe).
4. Override proc: `attendanceDeductionOverride` + reason + actor (own field, not variablePay); finalize locks.
5. monthlyReport (M5): server-side facility-scoped aggregate proc (no canViewStaffPunch) + UI panel + drill-down.
6. Punch-history UI (self + manager-scoped) using existing history endpoints.
7. Withdraw button (shift-reg-detail-panel).
8. permissions.ts approve/reject += giao_vien/sale/cskh (serialized #2); director bypass in assertAssignedApprover; director inclusion in shiftRegistrationPendingItems + dashboard inbox filter.
9. Notif fix: add nextManagerId recipient; managerId null → warning/fallback.
10. Tests: see below.

## Todo list
- [ ] Payslip deduction columns + migration (serialized after P1)
- [ ] assemblePayslip post-tax deduction input + domain tests
- [ ] penalty aggregation in assembleSlipData (ICT bucket) + recompute-on-override/reopen verified
- [ ] override proc (own field + reason + actor) + finalize lock
- [ ] monthlyReport server-side aggregate proc + UI + drill-down (no canViewStaffPunch)
- [ ] punch history UI (self + manager)
- [ ] withdraw button (perm exists)
- [ ] permissions approve/reject += staff (serialized #2) + director bypass in guard + inbox filters
- [ ] notif nextManagerId + managerId-null warning
- [ ] tests (see Risk/Test coverage)

## Success Criteria
- §6.2 payslip post-tax late/early deduction matches ICT-bucketed punch total; override reduces it; finalize locks; reopen re-derives.
- §6.3 monthlyReport (server-side aggregate) shows all facility staff + drill-down — reachable by directors WITHOUT canViewStaffPunch FORBIDDEN.
- §6.5 assigned manager approves own staff's packet; self-approve denied; BOTH directors approve any packet and see it in their inbox.

## Test coverage
- Unit: `assemblePayslip` post-tax math (deduction after PIT, non-negative guard); ICT bucketing boundary (23:xx ICT on last day → correct month even when next-day UTC); single-punch-day + >2-punch-day aggregation.
- Integration: deduction matches punch sum; override reduces + audited; finalize locks; reopen re-derives (manual punch approved after reopen changes number); payslipOverrideVariablePay does NOT wipe deduction; delegated staff approve own-assigned only; self-approve denied; non-assigned DIRECTOR ALLOWED (M1); director sees packet in inbox; notif reaches nextManagerId.

## Risk Assessment
- Penalty double-count / wrong month boundary — Med×High. ICT (+7) day boundaries (M6) with explicit boundary unit test; recompute idempotent; freeze on finalize.
- Override-variable-pay path wiping penalty (C2) — was CRITICAL. Mitigated by aggregating inside `assembleSlipData` (single source, recomputed every call); int test asserts penalty survives a post-compute variablePay override.
- Opening approve/reject perms broadens attack surface — Med×High. assertAssignedApprover is the gate for staff; director bypass is role-scoped; matrix test: staff cannot approve non-assigned/self; both directors approve all.
- Director drill-down FORBIDDEN via canViewStaffPunch (M5) — was MAJOR. Mitigated by server-side aggregate that never calls the per-user guard.
- Override abused to zero-out penalties silently — Low×Med. Require actor+reason audit on override.
- N5 (leads' approvals UI): after P2 sets managerId to leads, `dashboard.myApprovals` stays directors-only (`permissions.ts:66`) and cockpit approve buttons are director panels; leads discover packets via `shift-reg-list-panel` (approve button :58). Verify that panel renders the approve action for a non-director assigned manager; otherwise D5 is API-reachable but UI-dead for leads — confirm during impl.

## Security Considerations
- Override + penalty changes audited (actor, reason, amount).
- monthlyReport facility-scoped RLS; ke_toan/HR/directors only (perm :277).

## Rollback
- Permission: revert approve/reject role list (snapshot regen); handler guard unaffected.
- payslipCompute: deduction line is additive to compute logic; revert = remove aggregation block (finalized historical payslips already frozen — safe).

## Next steps
- P5 is permissions.ts edit #3 (afterSale) — runs after P4.
