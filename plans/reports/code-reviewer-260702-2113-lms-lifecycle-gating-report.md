# Review: LMS lifecycle gating (phase-05-lifecycle.md)

Scope: `packages/auth/src/lms.ts`, `apps/api/src/routers/attendance.ts`, `apps/api/test/lms-lifecycle-gating.int.test.ts` (uncommitted working-tree diff).

## Verdict: PASS — no blocking issues

## Verified against spec

**(a) Blocked set exact.** `BLOCKED_LMS_LIFECYCLE = {on_hold, withdrawn, transferred}` in `lms.ts:6`. Confirmed against `StudentLifecycle` enum (`schema.prisma:42-48`: admitted/active/on_hold/transferred/withdrawn/completed) — `completed`, `active`, `admitted` correctly excluded.

**(b) studentSession is the single choke point.** `loginStudent` (`lms.ts:98`) and `resolveLmsSession` (`lms.ts:122`) both call `studentSession`, which does `if (BLOCKED_LMS_LIFECYCLE.has(acc.student.lifecycle)) return null;` (`lms.ts:73`) before building the session. No parallel/login-only check exists that a live session could bypass — the per-request re-check in `resolveLmsSession` genuinely re-reads DB state via the same function. Confirmed by test `[revoke-on-set]`: login while active succeeds, `resolveLmsSession` succeeds, lifecycle flipped to withdrawn mid-test, next `resolveLmsSession` on the *same token* returns null.

**(c) parentSession per-child filter, not whole-session reject.** `lms.ts:51-53` filters `acc.guardians.map(g=>g.student)` by `!BLOCKED_LMS_LIFECYCLE.has(...)` before deriving `students`/`studentIds`/`facilityIds`; the `if (!acc || !acc.isActive) return null` check does not consider child lifecycle. Test `[one-blocked]` proves 1 active + 1 withdrawn child → session resolves, `studentIds` = [active only]. Test `[all-blocked]` proves both children blocked → session still resolves (`result !== null`), with `studentIds`/`students`/`facilityIds` all empty arrays, not null/rejected.

**(d) attendance.mark / markAll short-circuit correctly.** `mark` (attendance.ts:84-86): lifecycle check is a `throw` statement placed *before* the `tx.attendance.upsert` call — no code path reaches the write after this throw. `markAll` (attendance.ts:158-166): `.filter((e) => !BLOCKED_LIFECYCLE.has(...))` is applied to the `enrollments` array *before* it's mapped into the `Promise.all` upsert loop (line 172) — a filtered-out enrollment never enters the write batch. Both correctly layer on top of (not replace) the pre-existing `enrollment.status` guard. Test `[markAll-skips-blocked]` and `[mark-rejects-blocked]` cover a case the enrollment.status guard alone would miss: `enrollment.status: 'active'` but `student.lifecycle: 'on_hold'`.

**(e) Duplicate `BLOCKED_LIFECYCLE` const — verified in sync, precedent is real but the duplication itself is a legitimate follow-up item.**
- Values match exactly: `lms.ts:6` and `attendance.ts:16` both `['on_hold', 'withdrawn', 'transferred']`.
- `BLOCKED_LMS_LIFECYCLE` is genuinely not exported from `@cmc/auth`'s public surface (`packages/auth/src/index.ts:10-12` exports only `LmsSession`, `lmsRlsContextOf`, and the session functions — not the const), so importing it was not an option without also editing `index.ts`.
- The `ICT_OFFSET_HOURS` precedent cited by the implementer is real and pre-existing (attendance.ts:9-11, unchanged by this diff; mirror in `apps/api/src/lib/exercise-open.ts:4`, present since commit `7585282`) — not fabricated.
- Maintenance-risk assessment: low severity but real. A future edit to the blocked set in one file (e.g. adding `deferred` as a new lifecycle state) has no compiler or lint signal forcing the other file to update — only comments. Recommend (non-blocking): export `BLOCKED_LMS_LIFECYCLE` from `@cmc/auth`'s `index.ts` and have `attendance.ts` import it, eliminating the duplication now that both files are being touched anyway. Low cost, removes a silent-drift risk.

**(f) Blast-radius claim — inaccurate, undercounted by 2 sites (non-blocking, no functional impact).**
Implementer's claim: `context.ts` + "4 direct sites in index.ts (session-photo, exercise-pdf, SSE notifications initial+heartbeat)".
Actual `resolveLmsSession` call sites (grep-verified):
- `apps/api/src/context.ts:20` (feeds every `lmsProcedure`/parentProcedure/studentProcedure via ctx.lms)
- `apps/api/src/index.ts:126` `/files/session-photo/:ref`
- `apps/api/src/index.ts:166` `/files/exercise/:ref`
- `apps/api/src/index.ts:239` `/files/certificate/:id` — **missing from the report**
- `apps/api/src/index.ts:284` `/files/transcript/:studentId` — **missing from the report**
- `apps/api/src/index.ts:338` `/sse/notifications` (initial)
- `apps/api/src/index.ts:356` `/sse/notifications` (heartbeat re-check)

7 total call sites, not 5. No functional gap results from this — every call site routes through the same patched `resolveLmsSession`/`studentSession`/`parentSession` functions, so the certificate and transcript endpoints are correctly gated regardless of whether the report enumerated them. Flagging only because the report's blast-radius accounting was requested as a verification target and it is factually wrong — a reviewer relying on the report's site count to reason about coverage would have missed 2 real endpoints.

## Test run

`npx vitest run --config vitest.integration.config.ts test/lms-lifecycle-gating.int.test.ts test/guardian-principal-isolation.int.test.ts test/lms-full-lifecycle-e2e.int.test.ts test/lms-security-invariants.int.test.ts`
→ 4 files, 50 tests, all pass.

`pnpm --filter @cmc/api typecheck` → clean.
`pnpm --filter @cmc/auth typecheck` → clean.

New test file (`lms-lifecycle-gating.int.test.ts`, 10 tests) is not a phantom test — it exercises real DB state via `withRls(SUPER, ...)` fixture setup/teardown and asserts on actual return values (`toBeNull`, `studentIds` contents, thrown `TRPCError` code), not just "did not throw."

## Non-blocking follow-ups

1. Export `BLOCKED_LMS_LIFECYCLE` from `@cmc/auth`'s `index.ts` and import it in `attendance.ts` instead of maintaining a second copy — removes silent-drift risk on future lifecycle-set changes. (Item e above.)
2. Correct the blast-radius accounting in the implementer's own report/PR description before it's used as a coverage reference elsewhere — it undercounts `resolveLmsSession` callers by 2 (certificate, transcript endpoints). (Item f above.)

## Unresolved questions
None — spec's operator-final blocked-set decision was not re-litigated, matches implementation and tests exactly.
