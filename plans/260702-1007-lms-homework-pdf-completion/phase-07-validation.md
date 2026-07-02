# Phase 07 — Validation (integration + e2e + tablet checklist)

Validates all prior phases. This is the high-risk gate: authorization + redaction invariants MUST be test-covered before ship.

## Context links
- `apps/api/src/routers/submission.ts` (redaction, layer procs)
- Existing test setup (Vitest for API/unit, Playwright for e2e). Locate LMS e2e specs at implementation time.
- `apps/api/src/annotation.ts` (validation caps)

## Overview
Add integration tests for the new authorization/redaction/concurrency surfaces, an e2e pass for the LMS homework flow, and a manual tablet checklist for the annotator UX.

## Requirements (test matrix)

Integration (Vitest, real DB + RLS — no mocks per project rule):
- **Parent redaction pre-publish**: guardian calls `layerForGuardian` on child's ungraded/unpublished submission → teacher layer null, score/feedback null.
- **Parent post-publish**: after grade publish → teacher layer + score visible.
- **Cross-guardian denial**: guardian A requests guardian B's child studentId → FORBIDDEN/empty (both proc guard AND RLS).
- **Version conflict**: two saves with same stale version → second returns CONFLICT; first succeeds; version incremented.
- **Open-gate FORBIDDEN mid-edit**: with a submission mid-edit, cancel the session (`status → 'cancelled'`) OR archive the enrollment, then `submission.save` → FORBIDDEN (distinct from CONFLICT and from the unpublished-403). Assert the client-facing contract that this is the code the freeze-and-retain UX keys on.
- **Upload RBAC**: staff without `exercise.upsert` → 403 on `/upload/exercise-pdf`; director role → 200.
- **Redaction on save**: student save response never carries unpublished grade score/feedback.

E2E (Playwright):
- LMS student: open exercise, draw, autosave (close without manual save → reopen shows strokes), submit.
- LMS parent: view published drawn work read-only; confirm no edit controls. Confirm the base PDF serves to a guardian principal (global no-RLS exercise, decision 0022).
- **grading.tsx regression after P5/P6**: teacher opens a submission in the admin grading view (`grading.tsx:166-171`, shared PdfAnnotator) and can still draw a correction over the student `readOnlyLayers`, undo, and save — after the eraser/pen-width/pinch-zoom (P5) and lazy/virtualized render (P6) changes land. (Automation bucket — Playwright vs. manual checklist — is an open operator question; default to Playwright if the admin app has an e2e harness, else manual.)

Manual tablet checklist (kids 3-11):
- Eraser / per-stroke delete works by touch.
- Pen width switch visible + usable.
- Pinch-zoom + pan; strokes stay aligned after zoom.
- 20-page / ~20MB PDF opens, scrolls, renders lazily without freeze.
- MinIO-served PDF loads identically to disk.

## Related code files
- New/modify: `apps/api/src/routers/submission.test.ts` (or existing test file near submission router)
- New/modify: LMS e2e spec (locate existing Playwright dir)
- New: `plans/260702-1007-lms-homework-pdf-completion/reports/` manual tablet checklist result

## Implementation Steps
1. Add integration tests per matrix; use real seed accounts (guardian with 1+ children, a foreign guardian, a director, a non-director staff).
2. Add/extend Playwright LMS specs for autosave + parent read-only view.
3. Run full `pnpm` test + typecheck + build.
4. Execute manual tablet checklist on a real device; record results in reports/.

## Todo list
- [ ] parent redaction pre/post-publish int tests
- [ ] cross-guardian denial int test
- [ ] version conflict int test
- [ ] open-gate FORBIDDEN mid-edit int test (session-cancelled / enrollment-archived → FORBIDDEN)
- [ ] upload RBAC int test
- [ ] save-response redaction int test
- [ ] e2e autosave + parent read-only
- [ ] grading.tsx teacher-correction regression check after P5/P6
- [ ] full suite + typecheck + build green
- [ ] manual tablet checklist recorded

## Success Criteria
- All integration tests pass against real DB (RLS enforced, not mocked).
- E2E LMS flow green.
- Tablet checklist all-pass (or documented deferrals).

## Risk Assessment
- Test seed data for guardian/child/foreign-guardian relations missing (Med likelihood, Med impact): reuse LMS live verification harness (seed accounts) if present; else extend seed.
- Flaky autosave e2e timing (Med/Low): assert on persisted state after debounce, not on timers.
- Real-device tablet unavailable (Med/Med): fall back to browser touch emulation for gesture smoke; flag physical-device check as deferred if needed.

## Security Considerations
- The redaction + cross-guardian + upload-RBAC tests ARE the security gate for this round. Do not ship any phase whose authz test is red. No mocking of the DB/RLS layer — project rule (mock/prod divergence hid a broken migration before).

## Rollback
- Tests are additive; no rollback needed. If a test reveals a defect, block the corresponding phase, not this one.

## Next steps
Final phase. On green, round is complete; update docs/decisions if any authorization/contract changed (parent layer procedure, upload RBAC = candidate decision records).
