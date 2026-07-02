# Phase 6 — Validation: parity + int + e2e + decisions + DEBT + harness trace

## Context links
- Brainstorm §5 constraints, §6 success criteria; plan.md file-ownership (single snapshot regen here).
- Decisions dir latest id: 0023 → new records start at 0024. DEBT at repo root `DEBT.md`.
- Migration safety: `docs/operate-and-test-guide.md`, journal 260701-2254.

## Overview
Close the high-risk lane: regenerate the single RBAC parity snapshot after all 3 permissions edits, run the full test matrix (unit/int/e2e), author the 4 decision records, log DEBT items, and record harness traces.

## Key Insights
- Only ONE snapshot regen for the whole plan, done here AFTER P3→P4→P5 permissions edits landed in order — avoids three conflicting regenerations.
- Migration 0-drift already verified in P1; re-confirm here on prod-mirror after all code merges (schema untouched by P2–P5, but verify no accidental drift).

## Requirements
- Parity snapshot regenerated + committed; matches the 3 permission changes exactly (receiptCreate+sale, shiftRegistration.approve/reject+staff, afterSale+sale).
- Test matrix green (see below).
- 4 decision records authored + `harness-cli decision add`.
- DEBT.md additions.
- harness intake/story/trace checkpoints recorded.

## Test matrix
| Layer | Coverage |
|-------|----------|
| Unit | maskSensitive format; canReadSensitiveHr role predicate; penalty aggregation math; commission kind ordering |
| Integration | commission chain via UI path (new/win-back/mismatch-drop + auto-O5); payslip penalty deduction + override + finalize-lock; delegated shift approve + self-approve deny + cross-assignment deny; onboarding full record + masking matrix; afterSale sale scope + cross-facility deny; dup-phone warning |
| E2E (Playwright) | sale draft-receipt→director approve→O5; new-staff onboarding→SSO login; director monthlyReport drill-down |
| Migration | `prisma migrate reset` + `migrate diff` = 0 drift on prod-mirror |

## Decision records (author here)
- `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` — sale draft-only receiptCreate; receiptApprove auto-advances linked opp→O5; kind ordering rule.
- `docs/decisions/0025-attendance-penalty-payroll-deduction.md` — late/early punch penalty auto-deducted in payslipCompute; director override pre-finalize; freeze on finalize.
- `docs/decisions/0026-hr-sensitive-record-mask-only.md` — CCCD/bank plaintext + mask + role-gate (2 directors+super_admin) + audit; column encryption DEFERRED to DEBT (tradeoff stated).
- `docs/decisions/0027-delegated-shift-approver.md` — assigned managerId approves/rejects that packet via assertAssignedApprover; anti-self-approve retained; directors approve all. Also documents the afterSale sale-grant (D3) authorization broadening.

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
- [ ] Single parity snapshot regen (post P3+P4+P5) + diff review
- [ ] Unit + integration + e2e matrix green
- [ ] Migration 0-drift on prod-mirror
- [ ] 4 decision records + harness decision add
- [ ] DEBT.md additions
- [ ] harness story update + trace

## Success Criteria
- All §6 criteria demonstrably met by tests.
- Snapshot changes == exactly the 3 permission grants.
- 0-drift migration replay; typecheck clean; no weakened tests.

## Risk Assessment
- Snapshot drift from an unintended perm change — Med×Med. Diff-review the snapshot line-by-line against the 3 expected grants.
- E2E flakiness on SSO/login path — Low×Med. Reuse existing seed accounts + tRPC-over-curl verification harness.

## Security Considerations
- Verify masking holds across ALL EmploymentProfile read endpoints (not just onboarding) in int tests.
- Confirm no raw CCCD/bank in logs or audit bodies.

## Rollback
- Snapshot/decisions/DEBT are docs — revert by git. Code rollbacks live in each phase file.

## Next steps
- Plan complete; hand to implementation once seam-fixes (260702-0929) has landed.
