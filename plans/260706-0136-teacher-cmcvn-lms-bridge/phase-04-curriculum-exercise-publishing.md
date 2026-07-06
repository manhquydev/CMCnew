---
phase: 4
title: "Curriculum exercise publishing"
status: verified-existing-path
effort: "L"
---

# Phase 4: Curriculum exercise publishing

## Overview

Prove director exercise upload/publish works from the teacher domain while preserving the global curriculum/exercise model. This phase is smoke/fix-only unless a concrete missing behavior is observed, because the admin exercise manager and `exercise.upsert` already exist.

Governing rule: `CurriculumUnit` and `Exercise` are global academic assets without RLS. Write paths must enforce app-layer permissions; LMS visibility is derived at query time from enrollment/session/open rules.

Likely touchpoints:

- `apps/api/src/routers/curriculum.ts`
- `apps/api/src/routers/exercise.ts`
- `apps/api/src/index.ts` upload handlers
- `apps/api/src/lib/exercise-open.ts`
- `apps/api/src/services/exercise-open-notify.ts`
- `apps/admin/src/course-exercise-manager.tsx`
- `apps/lms/src/student-view.tsx`
- `apps/lms/src/parent-view.tsx`

## Implementation Steps

1. Before editing, run GitNexus impact on:
   - `exercise.upsert`
   - `assertExerciseOpenForStudent` if LMS open behavior changes.
   - upload handler symbols if upload contract changes.
2. Confirm directors can list curriculum units and create/update exercises through current permissions.
3. Improve the director UI only if smoke reveals a blocker:
   - Select curriculum unit/lesson.
   - Upload PDF/asset through existing upload endpoint.
   - Set title/status/publish metadata.
   - Show whether it is visible to enrolled students yet.
4. Do not edit exercise write paths unless smoke reveals a concrete gap.
5. Do not add `facilityId`, `classBatchId`, or `dueAt` back to `Exercise`.
6. Acknowledge the accepted direct-file exception:
   - LMS listing/submission are query-time gated by enrollment/session/open rules.
   - `/files/exercise/:ref` intentionally allows any authenticated principal to fetch non-archived worksheets by ref under decision 0022.
   - Do not rely on PDF ref secrecy for sensitive unpublished material unless a new decision supersedes 0022.
7. Ensure exercise publish triggers existing notification flow and does not notify students before session/enrollment visibility permits it.
8. Make exercise-open notifications durable enough for launch if smoke or tests reveal missed notification risk:
   - Existing post-commit notifier may remain, but a scheduled reconcile/worker must guarantee missed published/open pairs are repaired.
   - Add a failure-injection or idempotency test that proves a later worker catches a missed publish notification.
9. Do not add a separate `exercise.publish` route without an explicit role matrix; current publish behavior is through director-only `exercise.upsert`.
10. Add contract tests only where behavior changes. If UI-only, cover with Playwright smoke.

## Success Criteria

- [x] Directors can publish an exercise against a curriculum unit from teacher/admin shell.
  - Existing admin exercise flow and upload endpoint are reused; no new exercise contract was added.
- [x] Teacher cannot publish exercise unless permission registry allows it; current registry says exercise upsert is director-only.
- [x] LMS student sees exercise only when existing open/enrollment rules allow it.
- [ ] Published/open exercise notifications are either created inline or repaired by a durable scheduled path.
  - No new durability guarantee was added in this story.
- [x] Parent can see relevant homework/grade state through existing LMS view.
- [x] No schema change reintroduces per-class exercise rows.
- [x] Plan/docs acknowledge that direct PDF reads are broad authenticated reads by ref, per decision 0022.

## Status Update - 2026-07-06

Smoke/fix path verified with existing upload, exercise, submission, and parent/student LMS flows. Notification durability was not changed and remains outside the closed proof for this story.

## Tests

- Existing exercise/submission tests stay green:
  - `apps/api/test/submission-open-gate-forbidden-midedit.int.test.ts`
  - `apps/api/test/submission-version-conflict.int.test.ts`
  - `apps/api/test/submission-guardian-layer.int.test.ts`
- Add API/UI test only for any new exercise publish contract.
- Add notification durability/idempotency test only if publish behavior or worker guarantees change.
- Playwright smoke: director uploads/publishes a homework PDF, student can open after eligibility, parent can inspect state.

## Rollback

Because Exercise remains global, rollback should remove only UI shortcuts or new route changes. Existing exercise rows remain valid curriculum assets.
