# Phase 02 — Exercise API: TZ-safe auto-open + director-only per-unit upsert

## Context links
- Brainstorm §4 W1, D1, D2
- Decision A (exercise global no-RLS, app-layer gated)
- Pattern to mirror for the join: `schedule.sessionsForStudent` (`apps/api/src/routers/schedule.ts:429-465`)

## Overview
- Date: 2026-07-02
- Description: Rewrite `exercise.listForPrincipal` so a published exercise for unit U is visible to student S only after S's class has a `ClassSession` with `curriculumUnitId = U` whose end (`sessionDate` + `endTime`) is ≤ now in Asia/Saigon. Replace `create`/`publish` (per-class, giao_vien-owned) with director-only per-unit `upsert`. Remove `giao_vien` from exercise perms.
- Priority: P1
- Implementation status: pending
- Review status: not started
- Depends on: P1 (curriculumUnitId + global shape).

## Key Insights
- Current `listForPrincipal` (`exercise.ts:26-36`) relied on `exercise_isolation` RLS to scope to the principal's classes. After P1 there is NO RLS on exercise → the query MUST explicitly join sessions to derive visibility. Isolation now comes from the session/enrollment join, not RLS.
- Current shape returned: `Exercise + { batch: { name, course: { program, name } } }`. LMS consumers (`climb-view.tsx:19,56`, `student-view.tsx:39,307,779`) infer the row type via `Awaited<ReturnType<...>>[number]` and group by `batch.course.program`. Exercise no longer has `batch` (P1 dropped classBatchId). **The returned shape changes** → P4 must adapt. New source of program/name = the unit's `Course` (via `CurriculumUnit → Course`).
- `ClassSession` stores `sessionDate @db.Date` (midnight UTC) + `startTime`/`endTime` as "HH:mm" strings. "Ended" = `sessionDate`'s calendar day + `endTime` interpreted in Asia/Saigon (UTC+7, no DST) ≤ now. Must NOT compare raw UTC date+string against `new Date()` — that is the ICT/UTC trap called out in brainstorm §5.
- `create`/`publish` are `requirePermission('exercise', 'create'|'publish')`; perms at `permissions.ts:69-72` = `['giao_vien','giam_doc_dao_tao']`.
- `kpi-authz.ts` exists (`apps/api/src/lib/kpi-authz.ts`) — pattern reference for P5, not needed here.

## Requirements
1. New `upsert` procedure (replaces `create`+`publish`): `requirePermission('exercise','upsert')` = `['giam_doc_dao_tao','giam_doc_kinh_doanh']`. Input keyed by `(curriculumUnitId, type)` (+ title, description, basePdfRef, maxScore, starReward, status). **NO due/dueOffset field** (NO-dueAt decision). Upsert on the composite key `(curriculumUnitId, type)` — one homework AND optionally one test per unit. Full audit `logEvent` (shared asset; facilityId is null on exercise audit rows — acceptable, verify record_event null-facility read policy per M5-minor).
2. Remove `create` + `publish` procedures (per-class model gone). Update `permissions.ts:69-72`: `exercise: { upsert: ['giam_doc_dao_tao','giam_doc_kinh_doanh'] }` (giao_vien REMOVED). Regenerate permission snapshot.
3. Rewrite `listForPrincipal`: for the principal's owned students, find enrolled classes → their `ClassSession`s with non-null `curriculumUnitId`, **`status != 'cancelled'`** (mirror `sessionsForStudent`, `schedule.ts:441`), and end ≤ now(ICT) → the set of "opened" unit IDs → return published exercises for those units. **First-session-end rule**: a unit opens as soon as ≥1 of its (possibly N) sessions has ended (not the last). `orderBy` = `curriculumUnit.orderGlobal` (NOT dueAt — column dropped). Include unit's Course for program grouping.
4. **Submission write-path guards (C2 — isolation bypass + compile break)**: `submission.ts` `draftSave` (`:130-144`) and `submit` (`:183-191`) currently rely on the now-removed exercise RLS for enrollment scoping and read `ex.facilityId` (`:144`, column dropped in P1). Post-change both must: (a) gate on the SAME opened-unit check — reuse `openedUnitIdsFor(studentIds, tx)`; reject if the exercise's `curriculumUnitId` is not in the student's opened set (before-open or wrong-class → FORBIDDEN); (b) derive `Submission.facilityId` from the student's enrollment/batch (student row), NOT from the exercise. This is the write-side isolation gate that RLS used to provide.
5. `listByClass` (`exercise.ts:11-20`): re-point from `classBatchId` filter to the class's taught units (join ClassBatch → ScheduleSlot/ClassSession → curriculumUnitId → Exercise) OR keep a staff-facing "exercises for units this class teaches". Confirm shape used by any admin caller before changing.
6. TZ helper: compute session-end instant in Asia/Saigon deterministically (offset +07:00, no DST). Add a small pure helper + unit tests at hour boundaries (session ends 20:00 ICT = 13:00 UTC).

## Architecture
- Visibility data-flow: `principal.studentIds → Enrollment(active) → ClassBatch → ClassSession(curriculumUnitId, sessionDate, endTime, status!='cancelled') → [end ≤ now(ICT), first ended session opens the unit] → openedUnitIds → Exercise(status=published, curriculumUnitId ∈ openedUnitIds)`.
- **`openedUnitIdsFor(studentIds, tx)` is a SHARED helper** used by both `listForPrincipal` (read visibility) and the submission write-path guard (C2). Single source of truth for "opened" — do not duplicate the logic.
- End-time comparison: build `endInstantUtc = Date.UTC(y, m, d, hh - 7, mm)` from `sessionDate` (its UTC Y/M/D) + parsed `endTime`; visible iff `endInstantUtc <= Date.now()`. Encapsulate in `sessionHasEnded(sessionDate, endTime)`.
- Query strategy: prefer a single query — collect openedUnitIds via a `classSession.findMany` (mirroring `sessionsForStudent`'s enrollment join, `schedule.ts:439-443`) then `exercise.findMany({ where: { curriculumUnitId: { in }, status:'published' }, include: { curriculumUnit: { select: { course: { select: { program, name } } } } } })` (legacy rows hard-deleted in P1, no archived filter needed). Two round-trips is acceptable (KISS); the "ended" filter can't be pushed into SQL cleanly with string times.
- Return shape (stable target for P4): `{ ...exercise, program, courseName, unitCode }` — flatten so LMS grouping key is explicit, decoupling consumers from nested relation shape.

## Related code files
- `apps/api/src/routers/exercise.ts` — full rewrite of listForPrincipal, listByClass; replace create/publish with upsert; export `openedUnitIdsFor`.
- `apps/api/src/routers/submission.ts:130-144` (draftSave), `:183-191` (submit) — add opened-unit guard + derive facilityId from student, not `ex.facilityId` (C2).
- `packages/auth/src/permissions.ts:69-72` — exercise module (SHARED with P5; serialize edits).
- permission snapshot test file (find `permissions.snapshot`/parity test in `apps/api/test`).
- `apps/api/src/lib/` — new `session-time.ts` TZ helper (or colocate).
- `apps/api/test/grading-weights-db-parity.int.test.ts:70,130-131` — exercise create uses old shape; update to `(curriculumUnitId, type)` (cross-phase with P1/P7).

## Implementation Steps
1. Add `sessionHasEnded`/`openedUnitIdsFor(studentIds, tx)` helper (exclude cancelled sessions, first-ended-session rule) with unit tests (ICT boundaries).
2. Rewrite `listForPrincipal` using the two-step query; flatten program/courseName/unitCode into rows; order by `unit.orderGlobal`.
3. Replace `create`/`publish` with `upsert` keyed by `(curriculumUnitId, type)`; NO due field; add audit.
4. Patch `submission.ts` draftSave + submit: opened-unit guard via `openedUnitIdsFor`; derive facilityId from student enrollment/batch (C2).
5. Edit `permissions.ts` exercise module (remove giao_vien, add upsert); update snapshot.
6. Update/adjust `listByClass` (or remove if no live caller — verify with grep).
7. Add int tests (below) + parity snapshot update.

## Todo list
- [ ] TZ helper + boundary unit tests (cancelled excluded, first-session opens)
- [ ] listForPrincipal rewrite (join-based visibility, flattened shape, orderGlobal)
- [ ] upsert procedure (composite key, no due) + audit; remove create/publish
- [ ] submission.ts draftSave/submit guard + facilityId re-derivation (C2)
- [ ] permissions.ts exercise module + snapshot regen
- [ ] listByClass verified/updated
- [ ] int tests: auto-open before/after boundary, cross-student isolation, unpublished hidden, cancelled-session does NOT open, cross-class submit denied, submit-before-open denied

## Success Criteria
- Int test: exercise for unit U hidden before S's U-session end, visible after (ICT boundary exact); a cancelled session does NOT open the unit.
- Int test: student A never sees exercises for units only student B's class teaches (isolation via join, no RLS).
- Int test (C2): student cannot `draftSave`/`submit` against an exercise whose unit is not opened for them (cross-class OR before-session-end) → FORBIDDEN; Submission.facilityId derived from student, not exercise.
- Only `giam_doc_dao_tao`/`giam_doc_kinh_doanh` (+ super_admin) can upsert; giao_vien gets FORBIDDEN.
- Parity snapshot updated; `pnpm typecheck` green (no residual `ex.facilityId` read in submission.ts).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TZ off-by-one (UTC date vs ICT) makes exercise open a day early/late | High | High | Dedicated helper + boundary unit tests (13:00 UTC = 20:00 ICT); assert both sides of now(). |
| Lost isolation now that RLS is gone on exercise (READ + WRITE) | High | High | READ: visibility strictly derived from principal.studentIds join. WRITE: submission draftSave/submit re-check opened-unit via shared `openedUnitIdsFor` (C2) — without this ANY student could submit to ANY published exercise. Int tests cover both. |
| Reshaped return breaks LMS type inference silently | Med | Med | Flatten shape + explicit P4 adaptation; run LMS typecheck in P4/P7. |
| Removing create/publish breaks admin callers | Low | Med | Grep for `exercise.create`/`exercise.publish` callers before deletion; none expected in LMS (parity=0). |

## Security Considerations
- Decision A: `upsert` is the sole exercise write path and is permission-gated (no RLS backstop). The submission write path (draftSave/submit) is the OTHER app-layer gate that RLS previously covered — both must be enforced (C2). Verify no other exercise/submission write path exists ungated.
- Decision A record: `/files/exercise/:ref` file-serving loosens from enrolled-classes scoping to any-authenticated-principal (worksheets carry no PII) — acceptable, state explicitly in the durable record.
- Narrowing giao_vien perms is an intentional authorization change — must sync parity snapshot + e2e teacher-nav (P7).

## Next steps
- Shape + perms feed P3 (ERP upsert UI) and P4 (LMS consumption). Rollback: revert router + permissions to git; snapshot restore.
