# Phase 3 completion report — attendance bulk mark-all + reports + parent visibility

## Files modified
- `apps/api/src/routers/attendance.ts` — added `markAll`, `report`, `forStudent` (+`sessionEndUtc` import, local `ICT_OFFSET_HOURS`/`ictMonthKey` helper). ~230 new lines.
- `apps/admin/src/attendance-roster.tsx` — "Điểm danh tất cả có mặt" bulk button; preserves any per-row overrides already set, submits via `markAll`.
- `apps/lms/src/parent-view.tsx` — new `AttendanceHistoryCard` rendered above `SessionEvidenceTab` inside the `sessions` tab only. Gradebook tab / drawn-work modal untouched.
- `packages/auth/src/permissions.ts` — added `attendance.markAll` / `attendance.report` (`['giao_vien','giam_doc_dao_tao']`, same as existing `attendance.mark`). Required for the new procedures to authorize at all — the registry has no wildcard/inheritance (`can()` denies on missing action key).
- `apps/api/test/fixtures/permission-snapshot.json` — snapshot entries for the two new registry keys (parity test enforces exact match).
- `apps/api/test/attendance-report-markall.int.test.ts` (new) — 4 integration tests, real dev DB.

## Deviation from Files section (flagging, not asking)
Plan's Files section named only `markAll`/`report` for attendance.ts. Parent per-session visibility (a Requirement, not optional) had no data source reachable from `lmsProcedure` — `attendance.listBySession` is `protectedProcedure` (staff-only ctx.session), and `schedule.sessionsForStudent` (the LMS-facing session list) lives in `schedule.ts`, which is NOT in this phase's file ownership. Added a third procedure, `attendance.forStudent` (`lmsProcedure`, scoped to `ctx.lms.studentIds`), inside the file I do own rather than touching `schedule.ts`. Same shape/guard pattern as `schedule.sessionsForStudent` (facility+ownership check via `ctx.lms.studentIds`).

## N1/N3/N4 — how each was implemented
- **N4**: `report`'s teacher/director scoping is NOT derived from `requirePermission('attendance','report')` (that only gates who may call it, both roles pass). Inside the query: `isDirector = isSuperAdmin || roles.includes('giam_doc_dao_tao')`; teacher → `sessionWhere.teacherId = ctx.session.userId`, director → no teacher filter (RLS still bounds facility). Pattern copied from the existing `schedule.mySessions` `isManager`/`teacherFilter` convention (`schedule.ts:105-118`), not invented fresh.
- **N3**: `ictMonthKey()` reuses `sessionEndUtc` from `exercise-open.ts` (imported, file untouched) + a locally-duplicated `ICT_OFFSET_HOURS=7` (not exported there, so duplicated rather than modifying a file owned by an already-shipped phase). Note for the record: because `sessionDate` is a pure `@db.Date` column and `sessionEndUtc` computes `Date.UTC(sessionDate.y/m/d, hour-7, minute)`, adding the 7h back to bucket by ICT month is mathematically an exact inverse — the resulting month always equals `sessionDate`'s own UTC month regardless of `endTime`. So there's no live bug this specifically closes today, but it's the correct UTC-safe implementation (no local-timezone `getMonth()`/`getFullYear()` calls anywhere) and matches the mandated convention. Regression test (c) proves a session dated on a month boundary lands in its own calendar month.
- **N1**: `report`'s counts loop never filters on `session.isMakeup` — makeup sessions are counted like any other in `counts.total`/`counts.present`/etc. Test (d) isolates a single attended makeup session via a narrow term window and asserts `total=1, present=1, rate=1` (would be `total=0, rate=null` if makeup were excluded).

## markAll design
Single transaction (`withRls` tx + `Promise.all` of upserts inside it). Loads active enrollments (`status notIn [withdrawn, transferred]`) for the session's batch, applies `overrides[]` keyed by `enrollmentId` (unmatched override IDs are inert — only applied if they match a real active enrollment fetched from DB, closing an injection path). `excused` stays a boolean modifier per D-P5a (not a 4th status), matching existing `mark`.

## Tests
- `pnpm --filter @cmc/api typecheck` — clean
- `pnpm --filter @cmc/admin typecheck` — clean
- `pnpm --filter @cmc/lms typecheck` — clean
- `apps/api/test/attendance-report-markall.int.test.ts` — 4/4 pass (real dev DB, no mocks): (a) markAll all-active + override + excused + transferred-skip; (b) N4 teacher-vs-director scoping; (c) N3 month-boundary bucketing; (d) N1 makeup-in-denominator.
- `apps/api/test/permission-parity.test.ts` — 26/26 pass.
- Regression check: `enrollment-transfer.int.test.ts`, `attendance-payroll-deduction.int.test.ts`, `work-shift-attendance.int.test.ts` — 14/14 pass, no breakage from the `attendance.ts`/`permissions.ts` changes.
- Not run: E2E (no browser harness invoked this session — typecheck + int tests only, per acceptance criteria list).

## File-ownership note for P5 (lifecycle, shares attendance.ts) and P4 (shares parent-view.tsx)
- `attendance.ts`: new code appended after `mark`; existing `listBySession`/`mark` untouched byte-for-byte except the new imports at the top.
- `parent-view.tsx`: only the `sessions`-tab return block changed (wrapped `SessionEvidenceTab` in a `Stack` with the new card above it) plus one new component + 2 new consts. Gradebook tab and `DrawnWorkModal` untouched — confirmed by reading current file state before editing (Phase 2 LMS guardian-drawn-work additions already present, preserved as-is).

## Status
Status: DONE
Summary: markAll + report (with explicit N4 teacher/director scoping and N3 ICT-safe month bucketing, N1 makeup-inclusive rate) landed in attendance.ts; admin bulk-mark UI and parent per-session attendance card landed; all typechecks and integration tests (new + regression + permission parity) pass.
Concerns/Blockers: Added `attendance.forStudent` (not named in the phase's Files section) to satisfy the parent-visibility Requirement without touching `schedule.ts` (owned by another phase) — flagging for the orchestrator/P5 in case that's an unwanted scope addition. N3's `ictMonthKey` is provably a no-op vs. reading `sessionDate` directly given the current `@db.Date` schema (documented above) — implemented per the mandated convention anyway; worth knowing if `sessionDate` semantics ever change.
