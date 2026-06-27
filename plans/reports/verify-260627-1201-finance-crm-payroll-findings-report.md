# Verify: Finance / CRM / Payroll Review Findings

Adversarial re-verification of `plans/reports/20260627-103314-10-agent-code-review/04-finance-crm-payroll.md`
against CURRENT code (branch `develop`). Read-only. Report generated ~10:33 BEFORE the latest fix/deep-test wave,
so findings are checked against live source, not trusted.

## Verdict Table

| # | Finding | Report sev | Verdict | Re-rated sev | Evidence (file:line) |
|---|---------|-----------|---------|--------------|----------------------|
| 1 | Receipt commission attribution can attach to UNRELATED opportunity | High | **REAL** | High | `finance.ts:162` (free `opportunityId` input), `finance.ts:567-573,581` (approve reads `opp.ownerId`/`opp.stage`, no student/contact match), `payroll.ts:129` (commission keyed on `soldById`). Opp has no `studentId` FK (`schema.prisma:1033-1051`: only `contactId`+`studentName`). |
| 2 | CRM actor can set arbitrary opportunity owner | High | **REAL** | Medium | `crm.ts:108` (`ownerId` optional input), `crm.ts:121` (`ownerId: input.ownerId ?? session.userId`). No tree/self check. Create-only — no update path writes `ownerId` (grep confirms 2 hits only). |
| 3 | KPI sales prefill undercounts non-approved terminal receipts | High | **REAL** | Medium | commission filter `status: { in: ['approved','sent','reconciled'] }` `payroll.ts:131`; prefill filter `status: 'approved'` ONLY `payroll.ts:979`. Enum has distinct `sent`/`reconciled` states `schema.prisma:867-872`. Genuine parity gap. |
| 4 | KPI confirm/approve lacks manager-tree / self checks | High | **PARTIALLY REAL** | Medium | SoD (confirmer≠approver) IS enforced+tested: `payroll.ts:869-871` — do NOT contradict. BUT: confirm has no self-subject guard `payroll.ts:831-836`; approve blocks `confirmedById==actor` but NOT `subject==actor` `payroll.ts:868-871` (BGD can approve own sheet if another confirmed); neither calls a tree check (`kpi-authz.ts:18` `canOverrideKpi` used only by override). |
| 5 | Approved KPI can still be overridden | Medium | **REAL (arguably INTENTIONAL)** | Low-Med | `kpiOverride` has NO status gate `payroll.ts:1090-1103`; effective score = `overrideScore ?? autoScore` feeds payslip `payroll.ts:111`. Tree-authorized + audited + self-blocked (`kpi-authz.ts:19`). Decision 0011 tree-override is a deliberate post-hoc mechanism; payslip-finalize still blocks recompute (positive control). |
| 6 | Salary grade cleared without reason | Medium | **REAL (minor)** | Low | `gradeChanged = !!(existing && existing.grade && input.grade && ...)` `payroll.ts:220`. `grade: z.string().optional()` accepts `''`; empty string is falsy → `gradeChanged=false` → no reason required, yet `update` writes `grade:''` clearing the band. (`undefined` does NOT clear — Prisma no-op — so only `''` triggers it.) |

## Detail on the precise money/KPI claims

**#1 — confirmed REAL.** At `receiptApprove`, `soldById = opp.ownerId` and `kind` (new/renewal) derive from `opp.stage`,
but nothing validates the opportunity belongs to the receipt's student/contact. Opportunity carries only `contactId`+`studentName`
(no `studentId`), so any facility-scoped opportunity can be linked. The `classBatch`→course guard (`finance.ts:473`) exists but
there is NO analogous opportunity↔student guard. Result: wrong CVTV credited + new/renewal misclassified → wrong commission VND.
Gated to `finance.receiptCreate` + facility RLS + audit log, but accidental mis-selection is highly plausible → keep High.

**#2 — confirmed REAL.** `opportunityCreate.ownerId` is a free uuid; default is the creator, but any user with the permission may
credit ANY user. No tree/self constraint. Only writable at create (transitions/markLost/reopen never touch `ownerId`). Steers
future commission attribution (feeds #1). Medium (create-only, defaults to self, auditable).

**#3 — confirmed REAL, exact status lists verified.** Commission auto-feed counts `approved|sent|reconciled`; KPI `doanh_so`
prefill counts `approved` only. Once a receipt advances to `sent`/`reconciled`, its revenue still pays commission but vanishes
from the KPI revenue ratio → understated `doanh_so` score → understated `kpiBonus`. Fix: align prefill filter to the same
`{ in: ['approved','sent','reconciled'] }` set used at `payroll.ts:131`.

**#4 — distinguish carefully.** The deep-tests are correct that confirmer≠approver is enforced (`payroll.ts:869`). The remaining
REAL gaps are narrower than the headline: (a) a manager can CONFIRM their own submitted sheet (no subject≠actor check at confirm),
(b) a BGD can APPROVE their own sheet when a different person confirmed it (approve blocks confirmer-self, not subject-self),
(c) no management-tree restriction — any facility manager holding the permission can confirm/approve any sheet in the facility
regardless of reporting line. Fix: add `subject !== actor` guard to both, and reuse a tree check (extract from `canOverrideKpi`).

**#5 — REAL but likely intended.** `kpiOverride` mutates `overrideScore` regardless of `status` (incl. `approved`); that score
then wins in payslip computation. This is the decision-0011 tree-override correction path (authorized, audited, self-blocked),
so post-approval adjustment may be by design. Risk is bounded: finalized payslips block recompute. Recommendation (product call):
block override on `approved` rows unless formally reopened, or require re-approval after override.

**#6 — REAL minor.** Only the empty-string case bypasses the reason gate (clears the band silently). Low: HR-gated, narrow input.

## Positive controls spot-checked (hold)
- Commission/KPI both key on `soldById` consistently (`payroll.ts:129`, index `schema.prisma:988`).
- Grade-change reason gate works for actual value changes; `undefined` cannot clear (Prisma no-op).
- Approve recomputes `autoScore` from stored criteria + current weights (`payroll.ts:873-888`).

## Unresolved questions
- Is post-approval `kpiOverride` intended (decision 0011), or should approved rows be locked? (drives #5 severity)
- Should `confirm`/`approve` be restricted to the subject's management tree, or is facility-scope + SoD sufficient? (drives #4)
- For #1, what is the canonical opportunity↔student link to validate against (contact phone match? explicit studentId on opp?).

Status: DONE
