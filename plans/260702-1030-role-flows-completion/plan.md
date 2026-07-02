---
title: "Role-flows completion: commission chain + attendance-payroll + HR onboarding + CRM hygiene"
description: "Close the money-chain (commission attribution, attendance penalties into payslip) and people-chain (full HR onboarding record, delegated shift approval, CRM contact hygiene) gaps across sale / giáo viên / 2 directors."
status: completed
priority: P1
effort: 4-5d
branch: develop
tags: [crm, commission, payroll, attendance, hr, onboarding, rbac]
created: 2026-07-02
---

# Role-flows Completion (Plan 3)

Source of truth: `plans/reports/brainstorm-260702-1030-role-flows-completion-report.md` (D1–D6 FINAL, operator-approved — do not re-litigate).

## Lane & Intake (HIGH-RISK — FEATURE_INTAKE hard gates)

Hard gates tripped: **Authorization** (sale gains finance.receiptCreate + afterSale.*; delegated shift approve/reject opened to staff), **Data model** (EmploymentProfile new columns incl. sensitive CCCD/bank + migration), **Audit/security** (CCCD/bank sensitive read-gate + audit-on-change), **Existing behavior** (payslipCompute money math changes; receiptApprove auto-advances opp stage). ≥4 flags + 3 hard gates → high-risk lane.

Required durable artifacts (checkpoints, NOT code):
- High-risk story folder from `docs/templates/high-risk-story/` (execplan.md, overview.md, design.md, validation.md).
- **4 decision records** (next free id 0024; 0023 is latest):
  - 0024 commission: sale creates draft receipt from opportunity; sale keeps read-only view of own receipts (collectedById=self) post-hand-off via receiptListOwn (no approve); receiptApprove auto-advances linked opp → O5_ENROLLED (stamps closedAt); receiptCancel reverts it.
  - 0025 attendance-payroll: late/early penalty aggregated from live punches in assembleSlipData (self-healing), applied POST-TAX, director-overridable (own field) pre-finalize, ICT bucketing.
  - 0026 hr-sensitive-record: CCCD/bank stored plaintext, mask-only + role-gated read (2 directors + super_admin) + audit-on-change; column encryption deferred to DEBT.
  - 0027 delegated-shift-approver: assigned managerId may approve/reject that packet; anti-self-approve retained; both directors approve all.
- Harness checkpoints: `harness-cli intake` → `harness-cli story add`/`story update` (per workstream) → `harness-cli decision add` (0024–0027) → `harness-cli trace` at each phase close. ck runs the work; harness proves it.

## Phases

| # | Phase | Status | Link |
|---|-------|--------|------|
| P1 | Schema: EmploymentProfile new columns + migration + sensitive-field mask/authz helper design | completed | [phase-01-schema-masking.md](phase-01-schema-masking.md) |
| P2 | HR onboarding: user.create phone/guards/dup-email + profileUpsert extend + onboarding form + sensitive masking | completed | [phase-02-hr-onboarding.md](phase-02-hr-onboarding.md) |
| P3 | Commission chain: perm + opp→draft-receipt button + opportunityId pass-through + auto-O5 on approve | completed | [phase-03-commission-chain.md](phase-03-commission-chain.md) |
| P4 | Attendance→payroll: Payslip deduction column (C1) + post-tax penalty aggregated in assembleSlipData (C2) + override + ICT bucketing + monthlyReport server-side aggregate + history UI + withdraw + notif + delegated approver w/ director bypass (M1) | completed | [phase-04-attendance-payroll.md](phase-04-attendance-payroll.md) |
| P5 | CRM hygiene: contact directory + dup-phone warning + sale afterSale perm | completed | [phase-05-crm-hygiene.md](phase-05-crm-hygiene.md) |
| P6 | Validation: parity snapshot + int + e2e + 4 decisions + DEBT + harness trace | completed | [phase-06-validation.md](phase-06-validation.md) |

## Dependency graph

```
Plan 1 (seam-fixes 260702-0929) ── MUST land first (shared permissions.ts + payroll panels + snapshot)
   │
   ▼
P1 (schema migration + masking design)
   ├─> P2 (HR onboarding — extends seam-fixes P5 profileUpsert/rateCreate forms)
   ├─> P3 (commission chain) ─┐
   ├─> P4 (attendance→payroll) ┤ permissions.ts + snapshot serialize: P3 → P4 → P5
   └─> P5 (CRM hygiene) ───────┘
P6 (validation) depends on ALL (P1–P5)
```

## File ownership & serialization

- **`packages/auth/src/permissions.ts` + its parity snapshot** edited by P3 (finance.receiptCreate += sale AND new finance.receiptListOwn), P4 (shiftRegistration.approve/reject), P5 (afterSale.* + user.listAssignableForAfterSale). **Do NOT parallelize these three** — land edits in order P3 → P4 → P5, sequential commits, regen snapshot ONCE at P6 (diff = 4 modules, M7).
- `packages/db/prisma/schema.prisma` + migrations SERIALIZED: P1 (EmploymentProfile columns) → P4 (Payslip deduction columns, C1). P4 depends on P1 so no parallel collision; two migrations, replay both.
- P2 owns `apps/api/src/routers/user.ts`, `apps/admin/src/staff-profile.tsx`, `apps/admin/src/App.tsx` (UserCreateModal); EXTENDS `payroll.profileUpsert` forms from seam-fixes P5 — **HARD GATE: verify those UI callers exist at P2 start; build base form if absent (M4)**.
- P3 owns `apps/admin/src/finance-panel.tsx`, `apps/admin/src/opportunity-detail.tsx`, `apps/api/src/routers/finance.ts` (incl. receiptApprove auto-O5 + receiptCancel revert, M2/M3).
- P4 owns `apps/api/src/routers/{check-in-out,payroll,shift-registration,dashboard}.ts` + `packages/domain-payroll/src/payslip.ts` + Payslip schema/migration + attendance/shift panels.
- P5 owns `apps/api/src/routers/crm.ts`, `apps/admin/src/crm-panel.tsx` + new contact directory panel.

## Dependencies (cross-plan)

- Runs **AFTER** `plans/260702-0929-lms-erp-seam-fixes` (shared permissions.ts + payroll panels + snapshot; seam-fixes P5 wires the profileUpsert/rateCreate forms this plan extends).
- **MAY run parallel** with `plans/260702-1007-lms-homework-pdf-completion` (disjoint files: finance/crm/shift/user/payroll vs submission/annotator/parent-view) — re-verify disjointness at execution.

## Global success criteria (brainstorm §6)

1. Sale chốt O4 → "Tạo phiếu thu" (draft, opportunityId auto-linked) → director/kế toán duyệt → commission soldById + kind=new correct + opp auto → O5 (int test via UI path, no hand-called API). Sale retains READ-ONLY visibility of their own receipt (collectedById=self, via `finance.receiptListOwn`) incl. status after hand-off; no update/approve, no access to others' receipts, finance panel stays hidden.
2. Monthly payslip has a POST-TAX late/early deduction line matching ICT-bucketed punches (recomputed in assembleSlipData, survives override/reopen); director can override pre-finalize; finalize locks.
3. Director "Báo cáo công tháng" shows all facility staff: workdays, late/early, penalty; drill-down per-person punch history.
4. New-staff single form: email+phone+name+role+facility+manager+startedAt+(address/CCCD/bank) → SSO login works, has profile+rate, shift packets route to manager; CCCD/bank masked for non-privileged.
5. Team lead with managerId set approves that staff's shift packet; cannot self-approve; both directors approve ANY packet (explicit guard bypass, M1). managerId validated (no self/cross-facility/A↔B cycle, M8).
6. Contact directory searchable by phone/name; creating an opportunity on an existing phone warns with open opportunities.

## Migration safety (lesson: journal 260701-2254 work-shift chain fix)

P1 migration must replay from an empty DB with 0 drift. Verify `prisma migrate reset` + `prisma migrate diff` per `docs/operate-and-test-guide.md`. Rollback notes in each DB/permission phase file.
