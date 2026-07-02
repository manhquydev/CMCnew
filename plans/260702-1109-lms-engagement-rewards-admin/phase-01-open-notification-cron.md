# Phase 01 — New-exercise-open student notification (two-trigger)

## Context

- Exercises open query-time (Plan 1): `openedUnitIdsFor(tx, studentIds, now)` → `apps/api/src/lib/exercise-open.ts:28-55`; `assertExerciseOpenForStudent` (:57-93); `sessionHasEnded(date, endTime, now)` :24 (ICT +7). `listForPrincipal` gates visibility via `openedUnitIdsFor` (`apps/api/src/routers/exercise.ts:86-97`). No notification emitted when a unit opens.
- `exercise.upsert` (`apps/api/src/routers/exercise.ts:99-148`) flips `draft↔published` with NO `publishedAt` timestamp; `ClassSession` has NO `updatedAt` (`schema.prisma:324-349`). So publish time is untraceable — a session-end-only trigger structurally misses the LMS-common case "teacher uploads homework days after the session" (`lms-positioning-homework-platform` memory, `docs/decisions/0008-*`).
- Cron pattern to mirror: `apps/api/src/services/parent-meeting-reminder.ts` (SYSTEM_CTX super-bypass :7, idempotent stamp :76, `tx.notification.createMany` :41). Registered `apps/api/src/index.ts:385` under `DISABLE_CRON !== '1'`.
- Notification model: `schema.prisma:726` (`recipientType`, `recipientId`, `type`, `payload` Json). Realtime fan-out `emitNotification` (`apps/api/src/events.ts:21`).
- Label switch: `apps/lms/src/parent-view.tsx` `describeNotif` — `switch (n.type)` at :225, `default → "Thông báo mới"` fallback at :236. Re-grep at impl (line drift expected).

## Architecture — two triggers, one idempotency guard

The notification must fire whenever an exercise becomes **visible** to a student, regardless of event ordering. Visibility (per `openedUnitIdsFor`) = student has an active enrollment in a batch with a non-cancelled session for the exercise's `curriculumUnitId` that has ended in ICT, AND the exercise is `published`+not-archived. Two independent trigger points both converge on the same guard:

- **Trigger A — publish event** (`exercise.upsert`): after the upsert commits, if the resulting `status === 'published'`, run a notify pass for THAT exercise. Resolve every student for whom the unit is already open — i.e. the INVERSE of `openedUnitIdsFor`: "which students have this unit opened" rather than "which units does this student have opened". This catches the common case (exercise published long after the session ended). No time window — it scans all currently-open enrollments for that one unit.
- **Trigger B — session-end cron**: scan sessions that ended recently; for each opened `(unit → students)`, check whether a `published` exercise already exists on that unit; notify. This catches the reverse ordering (exercise existed, session just ended).

**Idempotency key = `(studentId, exerciseId)`**, NOT `(sessionId)`. A student is notified exactly once per exercise becoming visible to them, no matter which trigger fired or how many sessions/ticks touch it. Consequences:
- Neither trigger double-notifies the other (shared per-pair ledger).
- `editSlot.applyToFuture` moving a session earlier/later cannot cause premature or duplicate notifications — the check is "is it visible NOW", not "did this session end in this scan window" (resolves N2).
- Cron downtime is no longer lossy: Trigger A already covered every publish-before-session case; and because dedup is per-pair (not per-scan-window), Trigger B uses a lookback comfortably wider than expected downtime (below) so a missed tick is re-caught on the next tick with zero duplicates.

## Idempotency implementation (no schema change)

Dedup by existing notification rows (reuse the notification table as its own ledger; survives restart):
- Given candidate `(studentId, exerciseId)` pairs, query `notification` for rows `type='new_exercise_open'`, `recipientType='student'`, `recipientId IN studentIds`; extract already-notified `exerciseId`s from `payload`. Skip matched pairs; `createMany` the rest.
- Prisma JSON filtering on `payload->>'exerciseId'` is fragile — narrow by `recipientId + type` then filter pairs in memory (student notification volume is small). Store `{ exerciseId, curriculumUnitId }` in `payload` so the dedup read needs only recipient+type.

## Inverse helper (reuse, don't fork ICT math)

Add to `apps/api/src/lib/exercise-open.ts` a companion that mirrors `openedUnitIdsFor`'s EXACT predicate, inverted:

```
openStudentIdsForUnit(tx, curriculumUnitId, now) -> string[] (studentIds)
  find non-cancelled ClassSession where curriculumUnitId = X
    with an active, non-archived enrollment;
  keep sessions where sessionHasEnded(...);
  return distinct enrolled studentIds of those sessions.
```

**Predicate parity is a hard invariant: notify iff visible.** `openedUnitIdsFor` today filters `status != 'cancelled'` and does NOT exclude `isMakeup` (`schema.prisma:337`). The operator described the trigger as "completed non-makeup session", but excluding makeup HERE while `listForPrincipal` visibility includes makeup would desync (student sees exercise with no notif, or vice versa). Decision: mirror `openedUnitIdsFor` exactly (makeup NOT excluded) so notify == visible. Whether makeup should be excluded from BOTH visibility and notification is a seam-fixes (Plan 1) concern, flagged as unresolved Q below — do not diverge unilaterally.

## Trigger B scan window (downtime-safe)

- Scan sessions with `sessionEndUtc ∈ [now − 24h, now]`, ticked every 30 min; bound query by `sessionDate >= today-2` to keep it cheap. The wide 24h lookback survives ordinary deploy/restart downtime; per-pair dedup makes the heavy overlap free (no double-notify). Reuse `sessionHasEnded`/`sessionEndUtc` — do NOT reimplement ICT math.
- First-deploy backlog is bounded to the last ~24h of ended sessions (not all history), so no historic flood. Older already-ended sessions get their notif via Trigger A when/if their exercise is (re)published, or are accepted as not-notified (pre-feature).
- Filters: sessions `status != 'cancelled'`, `curriculumUnitId != null`; exercises `status='published'`, `archivedAt: null`.

## Files

- MODIFY `apps/api/src/lib/exercise-open.ts` — add `openStudentIdsForUnit(tx, curriculumUnitId, now)` mirroring `openedUnitIdsFor`. Run `gitnexus_impact` on `openedUnitIdsFor` before editing the file.
- CREATE `apps/api/src/services/exercise-open-notify.ts` — two entry points sharing one dedup+insert core:
  - `notifyForExercise(exerciseId)` (Trigger A) — SYSTEM_CTX `withRls`; load exercise, require `published`+not-archived; `openStudentIdsForUnit`; dedup; `createMany`; `emitNotification` per created row.
  - `runExerciseOpenNotifications(now?)` (Trigger B cron) — scan window above; per opened unit resolve published exercise(s); reuse the same dedup+insert core; returns `{sessionsScanned, notificationsCreated}`.
- MODIFY `apps/api/src/routers/exercise.ts` — in `upsert`, capture the upserted `exercise`, and after the `withRls` block resolves, if `exercise.status === 'published'` call `await notifyForExercise(exercise.id)` in its own SYSTEM_CTX pass (do NOT run inside the director's RLS tx). Await for determinism/testability; wrap in `.catch` log if publish latency becomes a concern (fallback). Run `gitnexus_impact` on `exercise.upsert` first.
- MODIFY `apps/api/src/index.ts` — register `cron.schedule('*/30 * * * *', ...)` in the existing `DISABLE_CRON` block (near :385); `.then/.catch` log like siblings.
- MODIFY `apps/lms/src/parent-view.tsx` `describeNotif` — add `case 'new_exercise_open'` (icon 📚, "Bài tập mới đã mở cho con") AND `case 'parent_meeting_reminder'` (icon 📅) to kill the fallback for both (brainstorm polish #5). Re-grep the switch/default at impl (:225/:236 drift). **Owner-serialize after Plan 2 P2.**

## Notification recipient

- `recipientType: 'student'`, `recipientId: studentId` — matches reminder convention so the principal-aware feed surfaces it to parents too. `emitNotification` per created row after commit (loop like `badge.ts:148`).

## Tests / validation

- Integration — **exercise published AFTER session ended** (common case): seed class + non-cancelled session ended in the past + active enrollment; then `exercise.upsert` status=published → Trigger A creates exactly 1 notif for that student.
- Integration — **exercise exists BEFORE session ends**: published exercise + enrollment; session end passes; cron tick → exactly 1 notif; second tick → 0 (per-pair dedup).
- Integration — **session moved later via editSlot**: exercise already visible+notified; `editSlot.applyToFuture` shifts the session → no premature and no duplicate notif (dedup by pair, visibility re-checked).
- Integration — both triggers on same pair (publish then session-end tick, or overlapping cron ticks) → exactly 1 notif total.
- Negative: cancelled session / draft (or later un-published) exercise / withdrawn (non-active) enrollment → 0 notifs.
- Manual: student/parent feed shows the new label for both types.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Trigger A predicate diverges from `openedUnitIdsFor` (notify≠visible) | M×H | Inverse helper mirrors the exact filter; parity asserted by "published-after-session" + negative tests |
| Duplicate notifications across triggers / restart | M×M | Single per-(student,exercise) dedup via notification ledger, not in-memory/per-session state |
| Trigger A blocks the upsert request path | L×M | Runs in its own SYSTEM_CTX pass after commit; switch to fire-and-forget `.catch` if latency observed |
| Plan 1 renames `openedUnitIdsFor`/reshapes open predicate | M×H | Re-grep at impl; adapt both the inverse helper and cron to whatever "opened" predicate seam-fixes ships — do not fork ICT logic |
| Cron downtime misses a session-end window | L×M | 24h lookback + per-pair dedup: missed tick re-caught next tick, no duplicate; publish-before-session already covered by Trigger A |
| JSON payload dedup filter unsupported | L×M | Narrow by recipientId+type, filter pairs in memory (volume small) |

- Rollback: remove cron registration + the `notifyForExercise` call in `upsert` + delete service + inverse helper. Label case + `openStudentIdsForUnit` are additive/harmless. No schema change → nothing to migrate back.

## Todo

- [ ] Add `openStudentIdsForUnit` to `exercise-open.ts` (mirror `openedUnitIdsFor` predicate exactly)
- [ ] Create `exercise-open-notify.ts` with shared dedup+insert core
- [ ] Trigger A: wire `notifyForExercise` into `exercise.upsert` post-commit (published only)
- [ ] Trigger B: `runExerciseOpenNotifications` cron scan (24h lookback) + register in `index.ts`
- [ ] `parent-view.tsx` label cases for `new_exercise_open` + `parent_meeting_reminder`
- [ ] Integration tests: publish-after-session, exercise-before-session-end (once), editSlot-move (no dup), both-triggers (once), negatives
