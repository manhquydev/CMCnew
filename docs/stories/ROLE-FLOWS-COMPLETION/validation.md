# Validation

## Proof Strategy

The high-risk lane requires: parity snapshot diff = only the 4 intended permission changes;
unit + integration + e2e green; migration 0-drift on prod-mirror (P1 + P4 chain); 4
decision records authored + harness-cli recorded; DEBT items appended. No test weakened.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `maskSensitive` format matrix; `canReadSensitiveHr` role predicate; penalty aggregation math; `assemblePayslip` POST-TAX deduction (after PIT, non-negative); ICT month-boundary bucketing (23:xx ICT last-day → correct month); single/>2-punch-day; commission `kind` ordering |
| Integration | commission chain via UI path (new/win-back/mismatch-drop + auto-O5 WITH closedAt); LOST same-name opp → no auto-won; cancel auto-won receipt → opp reverts to O4 (M3); adversarial renewal+fresh-opp (N4); sale sees own receipts post-approve + denied others'; payslip penalty deduction (post-tax) + override own-field + finalize-lock + reopen re-derive + variablePay-override does NOT wipe (C2); delegated shift approve + self-approve deny + cross-assignment deny + NON-ASSIGNED DIRECTOR ALLOWED (M1); director sees packet in inbox; onboarding full record + masking matrix + managerId reject (self/cross-facility/A↔B, M8); afterSale sale scope + cross-facility deny + assign-dropdown (M7); dup-phone warning |
| E2E (Playwright) | sale draft-receipt → director approve → O5; new-staff onboarding → SSO login; director monthlyReport drill-down (server-side aggregate, no FORBIDDEN) |
| Platform | Docker local validation; admin build PASS |
| Performance | penalty aggregation query scoped by date-range (large facility) |
| Logs/Audit | sensitive-field change writes field name only (no raw value); penalty override audited (actor+reason+amount); opp stage change audited |

## Fixtures

- Sale user (facility-scoped) with O4 opportunity + matching student.
- Director users (giam_doc_kinh_doanh, giam_doc_dao_tao).
- ke_toan user.
- Staff user with managerId set to a team lead.
- Team lead (managerId set, non-director).
- TimePunch records across ICT month boundary.
- Payslip in computed / finalized / reopened states.
- Existing contact with open opportunity on a phone number.

## Commands

```text
pnpm -r typecheck
pnpm -r test
pnpm --filter api test:integration
pnpm --filter e2e test:e2e
pnpm --filter db prisma migrate reset  # 0-drift replay
pnpm --filter db prisma migrate diff   # expect empty
```

## Acceptance Evidence

Partial evidence — P1/P2/P3/P4 complete; full P6 verification still pending.

- [x] P3 commission chain integration proof:
      `pnpm --filter @cmc/api exec vitest run test/role-flows-commission-chain.int.test.ts`
      PASS, 6/6. Covers sale draft receipt from opportunity, auto-O5 + closedAt,
      win-back `kind=new`, mismatch-drop, lost-opportunity no auto-won, cancel revert,
      and `receiptListOwn` self-scope.
- [x] P3 regression proof:
      `pnpm --filter @cmc/api exec vitest run test/commission-for-sale-e2e.int.test.ts test/receipt-kind-classification.int.test.ts test/crm-hooks.int.test.ts test/permission-parity.test.ts`
      PASS, 33/33.
- [x] P3 typecheck proof:
      `pnpm --filter @cmc/api typecheck` PASS; `pnpm --filter @cmc/admin typecheck` PASS.
- [x] P3 lint proof:
      `pnpm --filter @cmc/api lint` and `pnpm --filter @cmc/admin lint` PASS with
      pre-existing warnings only.
- [x] P4 migration proof:
      `pnpm --filter @cmc/db exec prisma migrate deploy` applied
      `20260702093600_payslip_attendance_deduction`.
- [x] P4 domain proof:
      `pnpm --filter @cmc/domain-payroll test -- --run` PASS, 57/57.
- [x] P4 integration proof:
      `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts test/check-in-out-time-calc.int.test.ts test/attendance-payroll-deduction.int.test.ts test/shift-registration-delegated-approver.int.test.ts test/payroll-finalize.int.test.ts test/payslip-commission-override.int.test.ts test/work-shift-attendance.int.test.ts`
      PASS, 46/46.
- [x] P4 focused rerun after UI/API select update:
      `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts test/attendance-payroll-deduction.int.test.ts test/shift-registration-delegated-approver.int.test.ts test/work-shift-attendance.int.test.ts`
      PASS, 36/36.
- [x] P4 typecheck/lint proof:
      `pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/admin typecheck`,
      `pnpm --filter @cmc/auth typecheck` PASS. `pnpm --filter @cmc/api lint`,
      `pnpm --filter @cmc/admin lint`, `pnpm --filter @cmc/auth lint` PASS with
      pre-existing warnings only.
- [x] P5 CRM hygiene proof:
      `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts test/cskh-assignable-staff.int.test.ts test/role-flows-crm-hygiene.int.test.ts test/aftersale-student-lifecycle.int.test.ts test/crm-sales-ops.int.test.ts`
      PASS, 42/42. Covers sale afterSale own-facility create/list/transition/assign,
      cross-facility denial/hidden rows, `setStudentLifecycle` denied, and assign picker M7.
- [x] P5 typecheck proof:
      `pnpm --filter @cmc/api typecheck` PASS; `pnpm --filter @cmc/admin typecheck` PASS.

- [ ] Parity snapshot diff = 4 modules only (receiptCreate+sale, receiptListOwn new,
      shiftRegistration.approve/reject+staff, afterSale.*+sale,
      listAssignableForAfterSale+sale).
- [ ] Unit tests green.
- [ ] Integration tests green (all cases above).
- [ ] E2E 3 flows green.
- [ ] Migration 0-drift (P1 + P4 chain).
- [ ] 4 decision records authored + harness-cli decision add.
- [ ] DEBT.md updated.
- [ ] harness-cli trace recorded at each phase close.
