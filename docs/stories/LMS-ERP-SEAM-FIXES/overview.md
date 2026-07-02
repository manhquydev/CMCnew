# ERP/LMS Seam Fixes

## Current Behavior

- Exercises are class/facility-scoped rows with RLS and teacher-facing create/publish UI.
- LMS exercise visibility relies on the old class-bound exercise shape.
- HR/payroll permissions point at `hr`/`ke_toan`, roles that are not held in the operating model.
- Several backend-ready seams are not wired in UI, and some old mock/auth surfaces remain reachable.

## Target Behavior

- Exercise becomes a global curriculum-unit asset with no RLS, app-layer write gates, and submission-side isolation.
- Published exercises auto-open to each student only after that student's class session for the unit has ended.
- Only the two directors can upsert exercise content; teachers keep read/grading flows, not write flows.
- Payroll/HR ownership moves to the two directors with write-domain scoping and a self-write block.
- Cleanup removes dead LMS/auth/UI seams while preserving public contracts intentionally kept in scope.

## Affected Users

- Students and guardians using LMS.
- Teachers grading submissions.
- Training and business directors managing curriculum and payroll.
- Super admin maintaining operational visibility.

## Affected Product Docs

- `plans/260702-0929-lms-erp-seam-fixes/plan.md`
- `docs/operate-and-test-guide.md`
- `docs/decisions/0021-curriculum-unit-global-no-rls.md`
- New decisions for Exercise no-RLS and HR/payroll director ownership.

## Non-Goals

- Manual per-class exercise publishing.
- Multi-exercise slots of the same type for one unit.
- Cron-based auto-open.
- Implementing every backend-ready deferred procedure listed by the audit.
