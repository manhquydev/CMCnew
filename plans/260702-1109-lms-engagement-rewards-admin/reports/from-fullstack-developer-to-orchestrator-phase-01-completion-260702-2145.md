# Phase 01 — exercise-open student notification (two-trigger): completion report

## Files modified

- `apps/api/src/lib/exercise-open.ts` — added `openStudentIdsForUnit(tx, curriculumUnitId, now)`. Mirrors `openedUnitIdsFor`'s current predicate exactly, inverted: tier A (class-wide, non-makeup session ended, active/non-archived enrollment in the unit's batch) + tier B (per-student makeup-session attendance override, no enrollment-status filter — matches `makeupOverrideUnitIdsFor` byte-for-byte). No existing function touched.
- `apps/api/src/services/exercise-open-notify.ts` (new) — `notifyForExercise(exerciseId, now?)` (Trigger A) and `runExerciseOpenNotifications(now?)` (Trigger B), sharing one `dedupAndCreate` core. Idempotency key `(studentId, exerciseId)` read back from existing `notification` rows (`type='new_exercise_open'`, `recipientType='student'`, filtered by `recipientId`, exerciseId extracted from `payload` in memory — no schema change). `facilityId` on each notification row is resolved from `Student.facilityId` (mirrors `sub.facilityId` pattern in grade.ts/badge.ts). Emits via `emitNotification` per created row, after the transaction commits (mirrors grade.ts's "fan out AFTER commit" comment).
- `apps/api/src/routers/exercise.ts` — `upsert` now returns from `withRls(...)` first, then (only if `exercise.status === 'published'`) calls `await notifyForExercise(exercise.id)` in its own `SYSTEM_CTX` pass, outside the director's RLS transaction. Nothing else in the file touched.
- `apps/api/src/index.ts` — registered `cron.schedule('*/30 * * * *', ...)` for `runExerciseOpenNotifications` inside the existing `DISABLE_CRON !== '1'` block, following the sibling cron jobs' `.then/.catch` + logger pattern. No other cron touched.
- `apps/lms/src/parent-view.tsx` — `describeNotif` gained `case 'new_exercise_open'` (📚, "Bài tập mới đã mở cho con") and `case 'parent_meeting_reminder'` (📅, includes meeting title). Only the switch statement touched.
- `apps/api/test/exercise-open-notify.int.test.ts` (new) — 5 integration tests, see below.

## Impact analysis (grep-based; gitnexus MCP tools were not available in this environment)

- `openedUnitIdsFor`: only caller is `exercise.ts:88` (`listForPrincipal`) — untouched, its logic and callers unaffected by the new sibling function.
- `assertExerciseOpenForStudent`: callers are `submission.ts:154,246` — untouched.
- `exercise.upsert`: callers are the admin UI (`course-exercise-manager.tsx`) and 3 test files. Return shape (`Exercise` row) is unchanged; only a post-commit side effect was added. Ran the full lifecycle e2e test (uses `exercise.upsert` as a director) and it still passes (2/2), confirming no regression in the request/response contract or latency-sensitive assertions.
- `emitNotification`: existing callers (`badge.ts`, `grade.ts`, `level-progress.ts`) untouched; the new service is an additional caller with the same event shape.

## Predicate parity (hard invariant)

`openedUnitIdsFor`'s current state (already carries the isMakeup two-tier gating from the seam-fixes phase) was re-read in full before writing the inverse helper. `openStudentIdsForUnit` mirrors it exactly: tier A excludes `isMakeup` sessions and requires active+non-archived batch enrollment; tier B is keyed on individual `Attendance` rows for makeup sessions (present/late), no enrollment-status filter, matching `makeupOverrideUnitIdsFor` line-for-line logic. No unilateral divergence — decided per the plan doc's flagged open question (makeup-exclusion-from-both-visibility-and-notification stays deferred to seam-fixes, not decided here).

## Tests — run against the real dev DB (Postgres 5433), no mocks

`apps/api/test/exercise-open-notify.int.test.ts`, 5/5 passing:

- (a) Trigger A: exercise published (via director `exercise.upsert`) AFTER its unit's session already ended → exactly 1 notification.
- (b) Trigger B: exercise exists BEFORE session end; `runExerciseOpenNotifications()` tick → exactly 1 notification; second tick → 0 new (per-pair dedup).
- (c) Session moved to a different, still-ended slot after being notified (simulates `editSlot.applyToFuture`'s effect on `ClassSession.sessionDate/startTime/endTime`) → no duplicate. Note: this exercises the dedup/re-visibility-check mechanics directly on `ClassSession`, not the `schedule.editSlot` mutation itself (that mutation only moves *future* sessions and requires `ScheduleSlot` fixture plumbing out of scope here); the invariant tested — "visible now" not "ended in this scan window" — is the one `editSlot` relies on.
- (d) Both triggers firing on the same pair (Trigger B first with no exercise yet → 0; then Trigger A via publish → 1; then Trigger B again → still 1) → exactly 1 total.
- (e) Negatives: cancelled session, draft exercise, withdrawn enrollment → 0 notifications each, plus `notifyForExercise` on a draft exercise directly → 0.

Regression: reran `schedule-makeup-session.int.test.ts` (5/5) and `lms-full-lifecycle-e2e.int.test.ts` (2/2, including `exercise.upsert` as a director) — all pass.

One test-design bug found and fixed along the way: initial fixtures shared a single `ClassBatch` across all 5 scenarios, and Trigger B's batch-wide enrollment check (which correctly mirrors production's class-wide "any active enrollment in the batch" semantics) opened every scenario's unit for every scenario's student. Fixed by giving each scenario its own `ClassBatch` — this was a fixture isolation bug, not a service bug (confirmed via temporary debug logging, since removed).

## Verification

- `pnpm --filter @cmc/api typecheck` — clean.
- `pnpm --filter @cmc/lms typecheck` — clean.
- No `dry_run`/rename tooling used (no renames performed).

Status: DONE
Summary: Two-trigger exercise-open notification shipped (publish-time + 30-min cron), single per-(student,exercise) dedup ledger reusing the notification table, predicate-parity inverse helper added without touching existing exercise-open functions, LMS label cases added. Typecheck clean both packages; 5 new integration tests + 7 existing regression tests all pass against the real dev DB.
Concerns/Blockers: none blocking. Note for reviewer: scenario (c) tests the dedup/session-move invariant directly on `ClassSession` fields rather than through the `schedule.editSlot` mutation (which only applies to future sessions and needs `ScheduleSlot` fixtures) — flagging in case the plan owner wants a follow-up test that goes through `editSlot.applyToFuture` explicitly.
