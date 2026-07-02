# Plan 5 (academic-ops) — P7 Final Validation Completion Report

## Status: DONE_WITH_CONCERNS

## What was already covered (no duplicate work added)
- P1 transfer: attendance preservation, blended final-grade, guard-on-old-enrollment,
  old-session still lists for the (student) LMS caller, over-capacity soft-warning —
  all 5 present in `enrollment-transfer.int.test.ts`.
- P2 makeup: creation/exclusion-from-recompute, room/teacher conflict, attendance on
  makeup session, C1 Tier-A/Tier-B exercise gate — all 5 present in
  `schedule-makeup-session.int.test.ts`.
- P3 attendance: markAll idempotent+overrides+excused+skip-transferred, N4 teacher-vs-
  director authz scope, N3 ICT month-bucket boundary, N1 makeup-counts-in-rate — all 4
  present in `attendance-report-markall.int.test.ts`.
- P4 transcript/cert: parent-own-child 200, IDOR 403, staff path unchanged, 401
  unauthenticated — all 7 present in `transcript-certificate-lms-access.int.test.ts`.
- P5 lifecycle: login-block for on_hold/withdrawn/transferred, live session revocation,
  completed-still-works, active-unaffected, parent C4 one-blocked / all-blocked,
  markAll/mark attendance guard — all 10 present in `lms-lifecycle-gating.int.test.ts`.
- P6 setSchedule/setNote persistence (staff side) already in
  `parent-meeting-time-tbd.int.test.ts`.

## Genuine gaps found and closed (additive only)

1. **P4 / C3 — "completed student can still download" was never actually exercised
   end-to-end.** `packages/auth/src/lms.ts:4-6` explicitly documents `completed` as
   excluded from `BLOCKED_LMS_LIFECYCLE` *specifically* so transcript/cert access
   survives — but no test drove a `lifecycle='completed'` student through the real
   `/files/transcript/:id` and `/files/certificate/:id` routes. P5's test only proves
   `loginStudent` succeeds for `completed`; P4's test only used a default-lifecycle
   child. Neither closes the loop. Added two tests to
   `apps/api/test/transcript-certificate-lms-access.int.test.ts`:
   - `parent of a completed-lifecycle child can still download transcript`
   - `parent of a completed-lifecycle child can still download certificate`
   Both create a `lifecycle: 'completed'` student + parent + FinalGrade + Certificate
   fixture and assert 200 + correct HTML through the real routes. Passing.

2. **P6 — "meeting setSchedule visible to parent" had no real assertion.** The
   existing `parent-meeting-time-tbd.int.test.ts` test named for this ("myMeetings
   query selects timeConfirmed in the payload shape") was explicitly commented as a
   SUPER-bypass DB-read proxy, not an actual call through the RLS-scoped `myMeetings`
   tRPC procedure — it never exercised `parent_meeting_isolation`'s enrollment-based
   RLS policy at all. Added one test:
   - `setSchedule result is visible to an enrolled parent via myMeetings; not visible
     to an unrelated parent` — builds a real enrollment in `classBatchId`, calls
     `lmsCaller(parentSession).parentMeeting.myMeetings()`, asserts the confirmed
     meeting (from the prior `setSchedule` test in the same file) appears with the
     correct `scheduledAt`/`timeConfirmed`, and that an unrelated parent (no
     enrollment in that class) sees nothing — proving the RLS policy, not just the
     schema shape. Passing.

No P1/P2/P3/P5 gaps found — those five phases' int coverage already maps cleanly onto
every bullet in the plan's Requirements steps 1-5.

## E2E specs status (step 2)
Ran `pnpm --filter @cmc/e2e test tests/admin-room-management.spec.ts
tests/admin-meeting-set-schedule.spec.ts` against the current environment.
**Still blocked** — identical failure to the one already logged in `DEBT.md` line 34:
`SyntaxError: Cannot use 'import.meta' outside a module` originating from
`packages/db/src/index.ts` → `seed-curriculum.ts`, triggered by both specs' direct
`import { withRls } from '@cmc/db'` (and `admin-meeting-set-schedule.spec.ts` also
imports `mintParentSession` from `@cmc/auth`). Environment has not changed since the
debt was logged; did not attempt to fix the underlying ESM/CJS resolver issue
(out of scope, already tracked).

## E2E PDF-download / lifecycle-block smoke (step 3) — assessed infeasible, skipped
Looked for a pure-UI path (no `@cmc/db`/`@cmc/auth` import) to smoke-test transcript/
certificate PDF download, following the `admin-crm-opportunity.spec.ts` pattern
(login via seeded staff creds, drive the UI, assert an observable result):
- The download itself is UI-trivial (`apps/lms/src/parent-view.tsx:516,654` —
  `window.open` to `/files/certificate/:id` / `/files/transcript/:studentId`), but
  reaching it requires an authenticated **parent** LMS session first.
- Found no seeded parent password-based login credential (`packages/db/src/seed-lms.ts`
  creates `ParentAccount` rows via `ensureParent(email, ...)` with no password field —
  parent auth is OTP/email-link based per `email-otp-login.int.test.ts`, not a static
  password like the staff `admin@cmc.local` account used elsewhere).
- Automating parent login purely through the UI would mean either reading a live OTP
  out of dev-mode server logs mid-test (fragile, couples the spec to log format) or
  importing `@cmc/db`/`@cmc/auth` to mint a session directly (the exact pattern
  already blocked by the DEBT.md ESM issue).
- Conclusion: not feasible within reasonable time without either the ESM fix or a new
  test-only OTP-bypass endpoint (both out of this task's scope). Skipped per the
  task's own instruction to skip and report rather than burn time chasing it.

## Migration drift (step 4)
`npx prisma migrate diff --from-url <dev DB 5433> --to-schema-datamodel
prisma/schema.prisma --exit-code` → **"No difference detected."** 0 unexpected drift,
confirms P1-P6 were additive/no-schema as the plan assumed.

## Harness (step 5)
Skipped per instruction — did not attempt `harness-cli`.

## Verification run
- `pnpm --filter @cmc/api typecheck` → clean.
- Full int suite: `npx vitest run --config vitest.integration.config.ts` →
  **98 files / 512 tests passed**, 0 failures, no auth-suite regressions from the P5
  lifecycle work.
- New/modified test files only: `apps/api/test/transcript-certificate-lms-access.int.test.ts`,
  `apps/api/test/parent-meeting-time-tbd.int.test.ts` (both additive; no existing test
  cases were rewritten).

## Files touched
- `apps/api/test/transcript-certificate-lms-access.int.test.ts` (+2 tests, +1 fixture
  block, cleanup extended)
- `apps/api/test/parent-meeting-time-tbd.int.test.ts` (+1 test, +1 import)

No application source files were touched. No commit made.

## Unresolved questions
- None blocking. The two e2e specs and the PDF-download smoke gap both trace back to
  the single already-tracked DEBT.md ESM/CJS entry — closing that unblocks all three
  at once; no new debt entry needed from this session.

Status: DONE_WITH_CONCERNS
Summary: Closed 2 genuine coverage gaps (P4 C3 completed-lifecycle download, P6 parent-visible myMeetings via real RLS) with 3 new tests, all passing; full int suite (512 tests) green; typecheck clean; migration drift 0. The 2 e2e specs remain blocked by the pre-existing DEBT.md ESM/CJS issue (unchanged, confirmed by re-running); a pure-UI PDF-download e2e smoke was assessed infeasible (no password-based parent test login exists) and skipped rather than time-boxed-chased.
Concerns/Blockers: e2e coverage for P6 room/meeting UI and any PDF-download smoke remains blocked pending the DEBT.md ESM/CJS fix — not new, just confirmed still open.
