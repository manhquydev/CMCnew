# Phase 01 — New-exercise-open student notification (cron)

## Context

- Exercises open query-time (Plan 1): `openedUnitIdsFor(tx, studentIds, now)` → `apps/api/src/lib/exercise-open.ts:28`; `sessionHasEnded(date, endTime, now)` :24 (ICT +7). No notification emitted when a unit opens.
- Cron pattern to mirror: `apps/api/src/services/parent-meeting-reminder.ts` (SYSTEM_CTX super-bypass :7, idempotent stamp :76, `tx.notification.createMany` :41). Registered in `apps/api/src/index.ts:385` under `DISABLE_CRON !== '1'`.
- Notification model: `schema.prisma:726` (`recipientType`, `recipientId`, `type`, `payload` Json). Realtime fan-out `emitNotification` (`apps/api/src/events.ts:21`).
- Label switch: `apps/lms/src/parent-view.tsx:225` (default → "Thông báo mới").

## Requirements

- Emit exactly one student notification (`type: 'new_exercise_open'`) per (studentId, exerciseId) when a published exercise's curriculum unit first opens (a non-cancelled session for that unit, on a class the student is actively enrolled in, has ended in ICT).
- Idempotent across re-ticks and across process restarts.
- Data flow: cron tick → find recently-ended sessions with `curriculumUnitId` → resolve published exercises on those units → resolve active-enrolled students of each session's batch → for each (student, exercise) not already notified, create notification + emit SSE.

## Idempotency design (decide + document)

No `remindedAt`-style column exists on ClassSession/Exercise for this. Two options — **choose (A)**:
- **(A) Dedup by existing notification rows (chosen, no schema change):** before insert, query `notification` for rows with `type='new_exercise_open'`, `recipientId in studentIds`, and `payload->>'exerciseId'` in candidate set; skip those pairs. Insert remainder via `createMany`. KISS/YAGNI: reuses the notification table as its own ledger; survives restart. Note: payload JSON filter needs a raw/`path` query — verify Prisma JSON filter support or narrow by recipientId+type then filter in memory (student notification volume is small).
- (B) New `ExerciseOpenNotice(sessionId, studentId)` unique table — rejected: extra migration for a dedup already expressible via notifications.

## Scope of "recently-ended" scan

- Scan window: sessions whose `sessionEndUtc` ∈ [now − 40min, now], ticked every 30 min (overlap tolerates a missed tick without gaps). Bound the query by `sessionDate >= today-1` to keep it cheap. Reuse `sessionHasEnded`/`sessionEndUtc` — do NOT reimplement ICT math.
- Only `status != 'cancelled'`, `curriculumUnitId != null`, `archivedAt: null` sessions; only `Exercise.status='published'`, `archivedAt: null`.

## Files

- CREATE `apps/api/src/services/exercise-open-notify.ts` — `runExerciseOpenNotifications(now?)`, mirrors reminder service (SYSTEM_CTX, `withRls`, returns `{sessionsScanned, notificationsCreated}`).
- MODIFY `apps/api/src/index.ts` — register `cron.schedule('*/30 * * * *', ...)` inside existing `DISABLE_CRON` block (near :385); import + `.then/.catch` log like siblings.
- MODIFY `apps/lms/src/parent-view.tsx:225` — add `case 'new_exercise_open'` (icon 📚, text `Bài tập mới đã mở cho con`) AND `case 'parent_meeting_reminder'` (icon 📅) to kill the fallback for both (brainstorm polish item #5). **Owner-serialize after Plan 2 P2.**

## Notification recipient

- `recipientType: 'student'`, `recipientId: studentId` — matches reminder convention so the existing principal-aware feed surfaces it to parents too. Emit `emitNotification` per created row after commit (loop like `badge.ts:148`).

## Tests / validation

- Integration: seed class+session ended + published exercise + active enrollment → tick creates 1 notif; second tick creates 0. Cancelled session / draft exercise / withdrawn enrollment → 0.
- Manual: student/parent feed shows the new label.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Duplicate notifications on restart | M×M | Dedup by existing notification rows (design A), not in-memory state |
| Plan 1 renames `openedUnitIdsFor`/removes helpers | M×H | Re-grep at impl; if reshaped, adapt scan to whatever "opened" predicate seam-fixes ships — do not fork ICT logic |
| Notification flood on backfill (many historic ended sessions) | M×H | Bound scan to [now−40m, now] + `sessionDate>=today-1`; never scan all history |
| JSON payload dedup filter unsupported | L×M | Fallback: fetch recipient+type notifs, filter pairs in memory |

- Rollback: remove cron registration + delete service file; label case is additive/harmless. No schema change → nothing to migrate back.
