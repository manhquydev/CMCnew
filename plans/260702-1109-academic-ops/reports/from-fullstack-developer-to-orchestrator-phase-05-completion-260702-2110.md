# Phase 5 completion — lifecycle enforcement

## Blast-radius analysis (M3, gitnexus MCP tool names not directly callable in this session;
grep-based caller analysis done instead, cross-checked against a GitNexus hook annotation on
one of the greps which confirmed the same edges)

`resolveLmsSession` (packages/auth/src/lms.ts):
- `apps/api/src/context.ts:20` — `createContext`, feeds `ctx.lms` for EVERY tRPC request.
  `ctx.lms` is consumed by `lmsProcedure`/`parentProcedure`/`studentProcedure` in
  `apps/api/src/trpc.ts:80-93`, i.e. every LMS-facing router (attendance.forStudent, assessment,
  submission, rewards, badge, leaderboard, notification, level-progress, parent-meeting, etc.)
- `apps/api/src/index.ts` — 4 direct call sites: `/files/session-photo` (:125), `/files/exercise`
  (:165), `/sse/notifications` initial auth (:266) and its 25s heartbeat re-check (:284).
- Re-exported via `packages/auth/src/index.ts:9` (not modified — read-only per file ownership).

`parentSession`/`studentSession` are private to lms.ts, only reached through
`loginStudent`/`mintParentSession`/`resolveLmsSession`, so the same call graph applies.
No other callers found in apps/lms, apps/erp, or apps/api outside test files.

Risk confirmed HIGH but contained: this is a shared-package identity resolver hit on every LMS
request; the change is additive (new lifecycle field on selects + a filter/reject), no shape
change to `LmsSession` beyond already-selected fields, so the SSE `/sse/notifications` heartbeat
re-check and the two `/files/*` byte-serving routes keep working unchanged for non-blocked
principals.

## Implementation

- `packages/auth/src/lms.ts`: added `BLOCKED_LMS_LIFECYCLE = {on_hold, withdrawn, transferred}`
  (Set, `completed`/`active`/`admitted` excluded). `studentSession` now selects `lifecycle` and
  returns `null` if blocked (covers `loginStudent` + `resolveLmsSession` re-check, since both call
  `studentSession`). `parentSession` now selects `lifecycle` on each guardianed student and
  per-child filters `students`/`studentIds`/`facilityIds` — never nulls the whole parent session;
  an all-blocked parent resolves with empty arrays instead of failing.
- `apps/api/src/routers/attendance.ts`: `mark` and `markAll` now also load `student.lifecycle`
  through the enrollment relation and reject/skip on the same blocked set, in addition to the
  pre-existing `enrollment.status` guard. Could not import the const from `@cmc/auth` (not
  exported there, and `packages/auth/src/index.ts` is out of my file-ownership scope) — duplicated
  it locally as `BLOCKED_LIFECYCLE`, following this file's own existing precedent for
  `ICT_OFFSET_HOURS` (comment explains why, same pattern).
- No schema/migration change — `StudentLifecycle` enum and `student.lifecycle` column already
  existed.
- Did not touch ERP lifecycle-badge UI (step 5 in the plan) — out of this phase's file ownership
  (`packages/auth/src/lms.ts`, `apps/api/src/routers/attendance.ts` only); `student.lifecycle` was
  already a plain field, nothing here removes or hides it.

## Tests — new file `apps/api/test/lms-lifecycle-gating.int.test.ts` (10 tests, all against real dev DB, no mocks)

- 3x student login rejected for on_hold/withdrawn/transferred.
- Live re-check: active session dies on the next `resolveLmsSession(token)` call immediately after
  the student's lifecycle flips to withdrawn (no re-login needed to observe it).
- `completed` student still logs in (transcript/certificate case — the one that would catch a
  mis-scoped blocked set).
- `active` student login unaffected.
- Parent with one active + one withdrawn child: session resolves, withdrawn child absent from
  `studentIds`/`students`/`facilityIds`, active child fully present.
- Parent with ALL children blocked: session resolves with empty `studentIds`/`students`/
  `facilityIds`, no throw.
- `attendance.markAll` skips a lifecycle-blocked student even when `enrollment.status` is still
  `active` (the scenario the existing status-only guard would have missed).
- `attendance.mark` on a lifecycle-blocked student rejects with `BAD_REQUEST`.

## Verification

- `pnpm --filter @cmc/auth typecheck` — clean.
- `pnpm --filter @cmc/api typecheck` — clean.
- New test file: 10/10 pass.
- Regression run (15 files, 86 tests) — all pass, no regressions: attendance-report-markall,
  lms-security-invariants, guardian-principal-isolation (the `lmsCaller`-based G1-G6 suite),
  lms-full-lifecycle-e2e, lms-student-account-provisioning, lms-sessions-for-student,
  enrollment-mine, enrollment-transfer, submission-guardian-layer, submission-version-conflict,
  submission-open-gate-forbidden-midedit, schedule-makeup-session, reward-review-refund,
  session-evidence-publish-to-lms, star-redeem.

## Coordination note

Did not touch `apps/lms/src/parent-view.tsx` (owned by the concurrent P4 phase). No file
conflicts encountered.

Status: DONE
Summary: Lifecycle gating shipped in packages/auth/src/lms.ts (per-child parent filter, whole-session reject for student) and apps/api/src/routers/attendance.ts (mark/markAll), with 10 new integration tests plus a clean 86-test regression run; both @cmc/auth and @cmc/api typecheck clean.
Concerns/Blockers: none.
