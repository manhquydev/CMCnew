# Phase 01 — Enrollment Transfer — Completion Report

## Executed Phase
- Phase: `phase-01-transfer.md` (Plan 5 — academic-ops)
- Plan: `D:\project\CMCnew\plans\260702-1109-academic-ops`
- Status: completed

## Files Modified
- `apps/api/src/routers/enrollment.ts` — added `transfer` mutation (+~100 lines), between `enroll` and `complete`.
- `packages/auth/src/permissions.ts` — added `enrollment.transfer: ['giam_doc_dao_tao']`.
- `apps/api/test/fixtures/permission-snapshot.json` — added `"enrollment.transfer": ["giam_doc_dao_tao"]` entry.
- `apps/api/test/enrollment-transfer.int.test.ts` — new file, 5 integration tests against the real dev DB (no mocks).

## Implementation notes
- `transfer({ enrollmentId, targetClassBatchId, effectiveDate?, reason? })`, guarded by `requirePermission('enrollment', 'transfer')`.
- Permission role: `giam_doc_dao_tao` (education director) only — reasoned as an academic-scheduling action (moving a student between classes), mirroring `complete`'s ownership, not `enroll`'s sales-side `['sale','giam_doc_kinh_doanh']`. This is a judgment call since the plan said "verify key naming before adding" without prescribing roles — flagging as unresolved Q below in case the operator wants KD included too.
- Single `withRls` tx: assert old status (`active`/`reserved` only; `transferred`/`withdrawn` → CONFLICT; same-batch target → BAD_REQUEST), assert target batch is `open`/`running`, dup-enrollment guard (mirrors `enroll`'s pre-check before the DB unique fires P2002), flip old → `transferred`, create new `active` enrollment (`opportunityId` copied, `createdByReceiptId: null`), soft-capacity check (never throws), chatter entry on `student` entity (mirrors the `enroll` mutation's student-lifecycle log shape) with a `changes` diff (`classBatchId`, `enrollmentStatus`) and a Vietnamese `body` line including `effectiveDate`/`reason` when supplied.
- Did **not** touch `exercise-open.ts`, `assessment.ts`'s `computeFinalGrade`, or `Attendance` rows — per the plan's explicit design decision and file-ownership boundary (P2 owns `exercise-open.ts`).
- Confirmed via read: `computeFinalGrade`'s attendance-rate query (`apps/api/src/routers/assessment.ts:229-238`) is `where: { enrollment: { studentId } }` — genuinely studentId-scoped, not enrollment-scoped, so the blend is real DB behavior, not an assumption.
- Confirmed via read: `schedule.ts sessionsForStudent` filters only `archivedAt: null` on enrollments (no status filter) — old sessions remain visible after transfer, as the plan asserts.

## Tests Status
- Type check: **pass** (`pnpm --filter @cmc/api typecheck`, clean, 0 errors)
- Unit tests: n/a (router-only change, no pure-function logic split out)
- Integration tests: **5/5 pass** (`apps/api/test/enrollment-transfer.int.test.ts`, run against real dev Postgres, no mocks)
  - (a) transfer flips old→`transferred`, creates new `active` enrollment, preserves old `Attendance` rows exactly (count=1, status unchanged)
  - (b) design-assertion: mixed old(1 present)+new(1 present+1 absent) attendance → stored `FinalGrade.attendanceRate` = 2/3 (blended), asserted `not.toBeCloseTo(0.5)` (the wrong, enrollment-scoped answer) to give the test teeth
  - (c) `attendance.mark` on the transferred old enrollment → `BAD_REQUEST` (existing guard, unmodified)
  - (d) unsubmitted old-class exercise → `FORBIDDEN` via `assertExerciseOpenForStudent` post-transfer (accepted, asserted as expected, not a regression); `schedule.sessionsForStudent` still lists the old session
  - (e) capacity-1 target batch already full → `transfer` still succeeds, returns `overCapacity: true`, `capacity: 1`, `enrolledCount: 2`
- Permission parity: `enrollment.transfer` snapshot entry added and passes in isolation. Full-suite run shows **1 pre-existing failure unrelated to this phase** — `finance.refundCreate`/`finance.refundList` (concurrent Plan-4 finance-ops phase) and `schedule.createMakeupSession` (concurrent Plan-5 P2 makeup-session phase) are present in `packages/auth/src/permissions.ts` but not yet in the snapshot fixture, because those phases are mid-edit in the same shared working tree right now. Verified via `git status` that `apps/api/src/routers/schedule.ts` is modified by someone else (not touched by me) — confirms this is not caused by my change. Their phases own updating the snapshot for their own new keys.

## Issues Encountered
- Initial `afterAll` cleanup used the wrong Prisma relation name (`classSession` instead of `session`) on `Attendance.deleteMany` — caught immediately by the first test run (Prisma validation error in cleanup, all 5 assertions had already passed), fixed, reverified.
- Working tree has concurrent uncommitted edits from other phases (Plan 4 finance-ops, Plan 5 P2 makeup) touching `packages/auth/src/permissions.ts` and `apps/api/src/routers/schedule.ts` — did not touch those files beyond the one `enrollment.transfer` line I own; confirmed no overlap with my file-ownership scope.

## Next Steps
- P5 (lifecycle enforcement) depends on this phase landing first — plan.md confirms P1 must precede P5 on the same student-lifecycle path. This phase is code-complete and tested; safe to unblock P5.
- Not committed per instructions — orchestrator to review/commit.

## Unresolved Questions
- `enrollment.transfer` role scope: I set `['giam_doc_dao_tao']` only (education-director, academic-scheduling framing). If the operator intends transfer to also be usable by `giam_doc_kinh_doanh` (business director, same set as `enroll`), that's a one-line change to `packages/auth/src/permissions.ts` + the snapshot fixture — flag before this ships to UI wiring.

Status: DONE
Summary: `enrollment.transfer` implemented as a single-tx, history-preserving router-only mutation; 5 real-DB integration tests cover history preservation, the intentional FinalGrade blend, the attendance guard, the accepted exercise-access cut with session-history preservation, and soft capacity — all pass, typecheck clean.
Concerns/Blockers: none blocking. One judgment call on permission role scope (see Unresolved Questions) that the operator may want to revisit.
