# UX audit action plan (persona-QA findings + form-to-Modal sweep) implemented

**Date**: 2026-07-03 14:34
**Severity**: N/A (planned UX fix work, not an incident)
**Component**: apps/admin, apps/lms, packages/ui — CRM, attendance/schedule, nav, 6 create-form panels
**Status**: Implemented, code-reviewed (APPROVE WITH MINOR NOTES), not yet committed

## What happened

Continued from `/brainstorm` (form-placement UX complaint → traced to `plans/260629-2127-odoo-parity-ux-framework`
Phase D, unblocked by a same-day persona-QA audit) and `/cook` (full harness chain: plan → red-team →
implement → review → audit). Full trace: `plans/260703-1354-ux-audit-action-plan/`.

Red-team caught a real blocker before implementation started: this session's feature branch was cut
from `develop`, which was 42 commits behind `main` — and `main` already had PR #26 shipping fixes
for 4 of the 6 originally-planned phases (#4, #5, #10, #15), in the exact files this plan targeted.
Fast-forwarded the branch to `main` tip, dropped the duplicated scope, re-verified every remaining
finding against live code before implementing. Effort 14h → 10h; Phase 2 (role labels) dropped
entirely — `ROLE_LABEL` was already exhaustive and wired.

Three phases (4, 5, 6) were implemented by parallel subagents since the plan's dependency table
confirmed disjoint file ownership; Phase 1 and 3 (plus two deferred items from Phase 5 that needed
files freed by Phase 1/3) done directly. One final consolidated code-review pass across all 21
changed files caught zero blockers — two low-severity notes (a silent no-op on missing `facilityId`
in `crm-panel.tsx`, a missing trailing newline) applied as quick fixes.

## Notable root-cause findings (not just symptom fixes)

- **#6** ("stage stepper highlights wrong current stage"): not an index-logic bug. The current-stage
  button used the app's reserved DANGER color token (`cmcRed` — same one used for error toasts and
  "rejected" status) instead of brand blue. A director glancing at the CRM pipeline read "you are
  here" as an alarm. One-line color fix, no logic touched.
- **#7** ("Nhân sự & Lương nav visible but denies GĐKD"): not a nav-gate mismatch. `NAV_GATES.hr`
  already correctly pointed at `payroll.roster` (grants both directors). The real bug was a
  hardcoded `['hr','ke_toan']` role array inside `payroll-panel.tsx` — the exact anti-pattern
  `shell.tsx`'s own comment warns against ("No hardcoded role arrays here... propagates
  automatically"). It predated `giam_doc_kinh_doanh`/`giam_doc_dao_tao` being granted
  `payroll.roster` in the permission registry and was never updated. Fixed by pointing the panel
  guard at the same `can()` check the nav uses.
- **#8** (attendance markable for unassigned/future sessions, no warning): read the server procedure
  first — `apps/api/src/routers/attendance.ts` enforces zero date/teacher-assignment rule, only role
  permission + data integrity. "Mirror the server gate" literally meant there was no gate to mirror,
  so implemented a warn+confirm (not hard-block) pattern to avoid a client rejecting what the server
  would accept.

## Verification

- `pnpm --filter @cmc/admin/@cmc/lms/@cmc/ui exec tsc --noEmit` — all exit 0.
- Full `@cmc/admin` vitest suite: 27/27 passing (including `nav-consistency.test.ts`, relevant to
  the #7 fix).
- `gitnexus_detect_changes(scope: all)` — 21 changed files, all within the plan's declared phase
  scope; no unexpected symbols touched. ("critical" risk label is GitNexus's own affected-process
  heuristic — every affected process is the touched file's own error/success-notification wiring,
  expected given how many independent create-handlers were touched.)

## Still open (flagged, not fixed — explicitly out of scope)

- `main`/`develop` have no sync mechanism: every PR merges into `main`, nothing merges back into
  `develop`, so every future feature branch forks stale. Needs a standing policy decision.
- Bucket B redesign-decision findings (#11, #12, #19, #22, #26, #29, #32) deferred to the
  `odoo-parity-ux-framework` Phase D (framework primitives + `/stitch` wireframes), per the original
  brainstorm's approach-A decision.
- Not yet committed, not yet pushed, no PR opened — awaiting user go-ahead.
