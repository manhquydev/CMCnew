# Phase 6 — Validation: parity + int + e2e + decisions + DEBT + harness trace

Status: completed 2026-07-02. Implemented and committed as part of the single bf8417d commit
(snapshot regen, unit/int matrix, 4 decision records, DEBT items); the E2E row of the test matrix
was NOT actually included in that commit despite the commit message — closed separately on
2026-07-02 (commits admin-commission-chain.spec.ts + admin-monthly-report-drilldown.spec.ts,
onboarding→SSO judged already-covered by existing admin-create-staff.spec.ts, SSO-login-itself
accepted as a permanent non-gap — see DEBT.md).

## Context links
- Brainstorm §5 constraints, §6 success criteria; plan.md file-ownership (single snapshot regen here).
- Decisions dir latest id: 0023 → new records start at 0024. DEBT at repo root `DEBT.md`.
- Migration safety: `docs/operate-and-test-guide.md`, journal 260701-2254.

## Overview
Close the high-risk lane: regenerate the single RBAC parity snapshot after all 3 permissions edits, run the full test matrix (unit/int/e2e), author the 4 decision records, log DEBT items, and record harness traces.

## Key Insights
- Only ONE snapshot regen for the whole plan, done here AFTER P3→P4→P5 permissions edits landed in order — avoids three conflicting regenerations.
- Migration 0-drift already verified in P1; re-confirm here on prod-mirror after ALL merges. NOTE: P4 ALSO adds a migration (Payslip deduction columns, C1) — the chain is P1 (EmploymentProfile) then P4 (Payslip); replay both.
- N7: decision ids 0024-0027 are "next free" as of planning; other in-flight plans may also mint 0024+. RE-CHECK `docs/decisions/` latest id at EXECUTION time, not now, and renumber if taken.

## Requirements
- Parity snapshot regenerated + committed; matches the intended grants exactly — now **4 modules** (M7): `finance.receiptCreate`+sale, `shiftRegistration.approve`+`reject`+staff, `afterSale.{list,create,transition,assign}`+sale, `user.listAssignableForAfterSale`+sale.
- Test matrix green (see below).
- 4 decision records authored + `harness-cli decision add`.
- DEBT.md additions.
- harness intake/story/trace checkpoints recorded.

## Test matrix
| Layer | Coverage |
|-------|----------|
| Unit | maskSensitive format; canReadSensitiveHr role predicate; penalty aggregation math; assemblePayslip POST-TAX deduction (after PIT, non-negative); ICT month-boundary bucketing (23:xx ICT last-day → correct month); single/>2-punch-day; commission kind ordering |
| Integration | commission chain via UI path (new/win-back/mismatch-drop + auto-O5 WITH closedAt stamped); LOST same-name opp → no auto-won; cancel auto-won receipt → opp reverts to O4 (M3); adversarial renewal+fresh-opp (N4); payslip penalty deduction (post-tax) + override own-field + finalize-lock + reopen re-derive + variablePay-override does NOT wipe (C2); delegated shift approve + self-approve deny + cross-assignment deny + NON-ASSIGNED DIRECTOR ALLOWED (M1); onboarding full record + masking matrix + managerId reject (self/cross-facility/A↔B, M8); afterSale sale scope + cross-facility deny + assign-dropdown works (listAssignableForAfterSale, M7); dup-phone warning |
| E2E (Playwright) | sale draft-receipt→director approve→O5; new-staff onboarding→SSO login; director monthlyReport drill-down (server-side aggregate, no FORBIDDEN) |
| Migration | `prisma migrate reset` + `migrate diff` = 0 drift on prod-mirror (P1 EmploymentProfile + P4 Payslip chain) |

## Decision records (author here)
- `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` — sale draft-only receiptCreate; receiptApprove auto-advances linked opp→O5 STAMPING closedAt + clearing lostReason (WON invariant, M2); skip advance on lost; receiptCancel reverts the auto-advanced opp to O4 (M3); kind ordering rule.
- `docs/decisions/0025-attendance-penalty-payroll-deduction.md` — late/early punch penalty aggregated in `assembleSlipData` from LIVE punches on every call (self-healing on override/reopen, C2); applied POST-TAX in `assemblePayslip` (subtract after PIT — does not distort taxable income, C1); director override is its own field+reason (not variablePay); ICT (+7) month bucketing (M6); "finalize freezes; reopen re-derives" (N6). Independent of KPI tuan_thu ratio + cumulative attendance-transfer blend.
- `docs/decisions/0026-hr-sensitive-record-mask-only.md` — CCCD/bank plaintext + mask + role-gate (2 directors+super_admin) + audit; column encryption DEFERRED to DEBT (tradeoff stated).
- `docs/decisions/0027-delegated-shift-approver.md` — assigned managerId approves/rejects that packet via assertAssignedApprover (anti-self-approve retained); BOTH directors approve all via an explicit director-role bypass ADDED to the guard + inbox filters (D5 stands; code was inconsistent, M1). Also documents the afterSale sale-grant + listAssignableForAfterSale (D3/M7) authorization broadening.

## DEBT.md additions
- Web-lead inbox (unbuilt); Callio sync (unbuilt); MS Graph provisioning ADR 0015 (Proposed-only, no code); badge admin UI; **column-level encryption for CCCD/bank (0026 deferred)**.

## Implementation Steps
1. Regenerate RBAC parity snapshot; diff = only the 3 intended changes.
2. Run unit → int → e2e; fix regressions (do not weaken tests).
3. Migration 0-drift replay on prod-mirror.
4. Author 4 decision files from `docs/templates/decision.md`; `harness-cli decision add` each.
5. Append DEBT.md items.
6. `harness-cli story update` per workstream + `harness-cli trace` at close.

## Todo list
- [x] Single parity snapshot regen (post P3+P4+P5) + diff review
- [x] Unit + integration + e2e matrix green (e2e closed 2026-07-02, separately from the main commit — see status note above)
- [x] Migration 0-drift on prod-mirror
- [x] 4 decision records + harness decision add
- [x] DEBT.md additions
- [ ] harness story update + trace (not verified this session — recommend confirming `harness-cli story update`/`trace` were actually run at the original P1-P5 close, not just documented as a requirement)

## Success Criteria
- All §6 criteria demonstrably met by tests.
- Snapshot changes == exactly the 4 intended grants (incl. listAssignableForAfterSale, M7).
- 0-drift migration replay (P1 + P4 chain); typecheck clean; no weakened tests.

## Risk Assessment
- Snapshot drift from an unintended perm change — Med×Med. Diff-review the snapshot line-by-line against the 4 expected grants (M7).
- Decision-id collision (N7) — Low×Low. Re-check `docs/decisions/` latest id at execution; renumber 0024-0027 if taken.
- E2E flakiness on SSO/login path — Low×Med. Reuse existing seed accounts + tRPC-over-curl verification harness.

## Security Considerations
- Verify masking holds across ALL EmploymentProfile read endpoints (not just onboarding) in int tests.
- Confirm no raw CCCD/bank in logs or audit bodies.

## Rollback
- Snapshot/decisions/DEBT are docs — revert by git. Code rollbacks live in each phase file.

## Next steps
- Plan complete; hand to implementation once seam-fixes (260702-0929) has landed.
