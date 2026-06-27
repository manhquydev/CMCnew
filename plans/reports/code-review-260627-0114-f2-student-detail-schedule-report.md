# F2 Red-Team Code Review — Student Detail + Schedule Fixes

Date: 2026-06-27
Branch: feature/erp-unify-rbac-f0 (F2 uncommitted; reviewed `git diff HEAD` + untracked `student-detail.tsx`)
Reviewer posture: adversarial / production-readiness

## Verdict: FIX-FIRST — 2 blockers

Scope: `apps/api/src/routers/schedule.ts`, `apps/api/src/routers/student.ts`,
`packages/db/prisma/schema.prisma`, migration `20260627010000_class_session_room_teacher_fk`,
`apps/admin/src/students-panel.tsx`, untracked `apps/admin/src/student-detail.tsx`.

Quick gate results:
- API typecheck: only pre-existing Azure module-resolution errors. No new TS errors.
- Admin typecheck: only pre-existing Azure errors. New detail page typechecks clean.
- API lint: **1 NEW error introduced by F2** (see B-1).
- Admin lint: 2 errors, both pre-existing in files F2 did not touch (payroll-panel, terms-panel).
- domain-academic tests: 15 pass — but none cover the F2 schedule changes (see H-2).

---

## BLOCKERS

### B-1 (CRITICAL) — `generateSessions` crashes on idempotent re-run / empty candidate set
`apps/api/src/routers/schedule.ts:154-156`
```ts
const candidateDates = fresh.map((c) => new Date(c.sessionDate));
const windowMin = candidateDates.reduce((a, b) => (a < b ? a : b));
const windowMax = candidateDates.reduce((a, b) => (a > b ? a : b));
```
`fresh` is the candidate list AFTER removing sessions that already exist for this batch
(idempotency filter at line 150). When all candidates already exist — i.e. a normal
re-run of `generateSessions` over the same date range — `fresh` is `[]`, so `candidateDates`
is `[]`, and `[].reduce(fn)` **with no initial value throws** `TypeError: Reduce of empty
array with no initial value`. Same crash if `enumerateSessions` yields nothing for the range.

Impact: This is a guaranteed runtime 500 on the documented idempotent path. The whole
procedure is designed to be safely re-runnable (comment line 144, return `{ created: 0, skipped }`).
Before F2 the unbounded query made empty-`fresh` a clean no-op; F2 regressed it into a crash.
The pure `detectConflicts` already handles `[]` correctly — the bug is purely the new window math.

Fix: early-return before computing the window when `fresh.length === 0`:
```ts
if (fresh.length === 0) {
  return { created: 0, skipped: candidates.length };
}
```
(Place it right after `fresh` is built, before `candidateDates`.) Add a test that re-runs
generation over an already-generated range and asserts `created: 0` with no throw.

### B-2 (HIGH) — New lint error breaks the `pnpm --filter @cmc/api lint` gate
`apps/api/src/routers/student.ts:8`
```
8:7  error  'lifecycle' is assigned a value but never used  @typescript-eslint/no-unused-vars
```
F2 removed `lifecycle` from `student.update` input/data but left the
`const lifecycle = z.nativeEnum(StudentLifecycle)` validator (line 8). It is now dead and
fails lint (eslint exits 1). `program` (line 7) is still used by `student.create`, so only
`lifecycle` is dead. Verified via `pnpm --filter @cmc/api lint`.

Fix: delete line 8. `StudentLifecycle` import becomes unused too — drop it from the line-2 import.

---

## NON-BLOCKING FINDINGS

### M-1 (MEDIUM) — `student.detail` cross-facility denial returns 500, not the documented NOT_FOUND
`apps/api/src/routers/student.ts:18,24`
The comment says "a student from another facility returns NOT_FOUND." Under RLS a
cross-facility (or non-existent) row is invisible, so `findUniqueOrThrow` raises Prisma
`P2025`. There is **no P2025→NOT_FOUND mapping** anywhere (`mapRlsErrors` in `trpc.ts:26`
only maps write-path 42501). So the client receives an unmapped `INTERNAL_SERVER_ERROR` (500),
not 404. Security is intact (no data leak, the row is genuinely hidden), but the contract/comment
is wrong and 500s pollute error logs. Note: the pre-existing `update` path (line 143) has the
same `findUniqueOrThrow` behavior, so this is a latent issue, not F2-introduced — but F2's
comment makes a false claim. Either map P2025→NOT_FOUND or correct the comment.

### H-2 / M-2 (MEDIUM) — "Bug A" and "Bug B" ship with ZERO new automated coverage
`git diff HEAD` adds no test files. `schedule.test.ts` is unchanged (the 8 tests are
pre-existing and only exercise the pure `detectConflicts`/`enumerateSessions` — they do NOT
touch the new DB date-window filter, the empty-`fresh` path, or the migration). The implementer's
claim of new tests is unsubstantiated by the diff. The window-narrowing logic itself is correct
(see verification below), but B-1 would have been caught by a single re-run test. Recommend:
router-level test for (a) re-run idempotency (catches B-1), (b) a real cross-day same-room/same-
teacher conflict still rejected with the window in place.

### L-1 (LOW) — `ScheduleSlot.roomId` / `teacherId` still have no FK (implementer-flagged scope gap)
Verdict: **genuinely separate, low risk — leave it.** Conflict detection reads `ClassSession`
(now FK-backed), not `ScheduleSlot`. Rooms and users are soft-deleted (`archivedAt`; no hard
`.delete` exists in the API — grep-confirmed), so a slot can't dangle to a removed row and
`generateSessions`' `createMany` won't hit the new ClassSession FK in practice. Adding slot FKs
is template-integrity hygiene, not a correctness fix for this feature.

---

## VERIFICATION OF THE FIVE RISK AREAS

1. **Schedule date-filter correctness — SAFE (no missed conflicts).**
   `detectConflicts` (`packages/domain-academic/src/schedule.ts:60`) only ever flags rows where
   `c.sessionDate === e.sessionDate` (same calendar day; different days are skipped). Every
   candidate date lies within `[windowMin, windowMax]` by construction, so any existing facility
   session that could conflict is necessarily on a date inside the window and is loaded by the
   query (`schedule.ts:157-164`). Same room/different day → correctly NOT flagged; same room/same
   day overlapping time → still loaded and flagged. Boundary alignment holds: `sessionDate` is
   `@db.Date`, stored and queried via `new Date("YYYY-MM-DD")` (UTC midnight) consistently
   (`dateKey` line 9, createMany line 189), so `gte/lte` includes same-day rows. The narrowing is
   semantically equivalent to the old unbounded scan for conflict purposes. The ONLY defect is the
   empty-window crash (B-1), not a missed double-booking.

2. **Migration safety — SAFE.** `20260627010000`: orphan-nulling `UPDATE`s (steps 1-2) run
   BEFORE `ADD CONSTRAINT` (steps 3-4), so existing data can't fail the constraint. FKs are on
   nullable columns with `ON DELETE SET NULL`. `teacher_id` references `app_user(id)` — correct:
   `teacherId` is an AppUser id (e.g. `payroll.ts:1011` sets `teacherId: input.userId`;
   `schedule.ts:82` `teacherFilter = session.userId`). No separate teacher table exists. `NOT IN
   (SELECT id ...)` is safe since `id` PKs are non-null. Won't fail on existing data; only nulls
   true orphans.

3. **student.detail RLS + N+1 — SAFE.** Uses `protectedProcedure` — identical gate to
   `student.list` (consistency confirmed). `protectedProcedure` requires `ctx.session` (staff
   cookie); LMS parent/student principals only populate `ctx.lms` (`context.ts:18-20`), so they
   hit `UNAUTHORIZED` — no parent/LMS over-exposure. RLS via `withRls(rlsContextOf(ctx.session))`
   hides cross-facility rows (denial surfaces as 500, see M-1, but the row is not exposed).
   Includes are bounded to a single student (guardians, archived-filtered enrollments, receipts,
   finalGrades) with nested `select`s — Prisma batches these; no per-row N+1 loop, no unbounded
   fan-out. (Caveat: receipts/finalGrades have no `take` cap — acceptable for per-student volume.)
   No test proves cross-facility denial (the diff adds none) — recommend one.

4. **Edit restriction — COMPLETE.** `student.update` input now only accepts `id`, `fullName`,
   `dateOfBirth`; `data` writes only those (`student.ts:133-150`). `program`/`lifecycle` cannot be
   mutated via this path — verified no residual assignment. Frontend mirrors it (program/lifecycle
   removed from edit form, `students-panel.tsx`). Audit `logEvent` fires on every update, including
   the no-change branch (line 165+). Good. (Dead `lifecycle` validator is B-2.)

5. **ScheduleSlot FK gap** — see L-1: separate, low risk, leave it.

6. **Typecheck/lint** — API & admin typecheck clean apart from known Azure module-resolution.
   API lint: 1 NEW error (B-2). Admin lint: 2 errors, both pre-existing and outside F2's files.

## Unresolved questions
- Is `student.detail`/`update` intended to return 404 on cross-facility access? If yes, a
  shared P2025→NOT_FOUND mapper is warranted (affects M-1 severity).
- Were router-level schedule tests expected for F2? The phase doc implies coverage; the diff has none.
