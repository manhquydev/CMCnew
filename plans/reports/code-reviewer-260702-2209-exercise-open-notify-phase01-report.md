# Code Review — Phase 01 exercise-open notification (two-trigger)

Scope: apps/api/src/lib/exercise-open.ts (openStudentIdsForUnit only), apps/api/src/services/exercise-open-notify.ts (new), apps/api/src/routers/exercise.ts (upsert notify call), apps/api/src/index.ts (cron registration), apps/lms/src/parent-view.tsx (describeNotif cases), apps/api/test/exercise-open-notify.int.test.ts (new).

## Verification run
- `npx vitest run --config vitest.integration.config.ts test/exercise-open-notify.int.test.ts test/schedule-makeup-session.int.test.ts test/lms-full-lifecycle-e2e.int.test.ts` → 3 files, 12 tests, all pass.
- `pnpm --filter @cmc/api typecheck` → clean.
- `pnpm --filter @cmc/lms typecheck` → clean.

## Predicate-parity check (top priority) — PASS

Read `openedUnitIdsFor` (exercise-open.ts:65-100, includes the makeup two-tier gating from the already-shipped earlier phase) side by side with `openStudentIdsForUnit` (exercise-open.ts:105-157).

- Tier A: `openedUnitIdsFor` filters `ClassSession` by `status != cancelled`, `curriculumUnitId not null`, `isMakeup: false`, `batch.enrollments some { studentId in list, status: active, archivedAt: null }`, then `sessionHasEnded`. `openStudentIdsForUnit` filters the same session predicate for one fixed `curriculumUnitId`, selects `batch.enrollments where { status: active, archivedAt: null }` (no student filter, since it enumerates rather than tests membership), same `sessionHasEnded` gate. This is a correct structural inversion: the same conjunction of conditions, one direction tests EXISTS for a given student set, the other ENUMERATES students for a given unit.
- Tier B (makeup): `makeupOverrideUnitIdsFor` filters `Attendance` by `status in [present, late]`, `enrollment.studentId in list`, `session.isMakeup: true`, `session.curriculumUnitId not null`, `session.status != cancelled`, then `sessionHasEnded`. `openStudentIdsForUnit`'s makeup block filters the same attendance predicate for one fixed `curriculumUnitId` (no student restriction), same `sessionHasEnded` gate. Both sides omit an enrollment-active check on the makeup path — this is a genuine symmetry, not a divergence (neither function checks it, so parity holds either way).
- `sessionHasEnded`/`sessionEndUtc` reused unmodified on both sides — no forked ICT math.

No parity gap found. `notify == visible` holds for both tiers as currently implemented.

## Critical Issues

None found in scope (no auth/authz bypass, no data leak, no schema break).

## High Priority

### 1. Genuine TOCTOU race in `dedupAndCreate` — can double-notify (exercise-open-notify.ts:32-76)
`dedupAndCreate` reads existing `notification` rows (`type='new_exercise_open'`, `recipientId in studentIds`), computes an in-memory "already notified" set, then inserts the remainder — all within one `withRls` transaction. But Trigger A (`notifyForExercise`, called from `exercise.upsert`) and Trigger B (`runExerciseOpenNotifications`, cron every 30 min) run in **separate** `prisma.$transaction` calls (separate `withRls` invocations, `exercise-open-notify.ts:98` and `:132`). Postgres default (and this codebase's, per `withRls` in `packages/db/src/index.ts:56` — no `isolationLevel` override) is Read Committed. Two concurrent transactions on the same `(studentId, exerciseId)` pair can both execute the `findMany` read before either commits its `create`, both see "not yet notified", and both insert — producing a duplicate notification. There is no unique constraint on `Notification` backstopping this (`schema.prisma:727-740`: only non-unique indexes on `(recipientType, recipientId, readAt)` and `facilityId`).

This is the same class of bug already found and fixed elsewhere in this session's work: `rewards.ts` `markDelivered` (rewards.ts:302-326) explicitly replaced a read-then-write status check with a conditional `updateMany({ where: { id, status: 'approved' } })` specifically because "a concurrent double-call can't both pass the status check — the WHERE re-validates status atomically at the DB level." `dedupAndCreate` does not apply that pattern — it is a plain read-then-write with no atomic guard.

- No integration test exercises actual concurrency: scenario (d) in `exercise-open-notify.int.test.ts:236-263` runs Trigger B then Trigger A then Trigger B again **sequentially** (`await` each call), which never opens the race window. It proves dedup works within isolated turns, not under overlap.
- The implementer's completion report (`.../reports/from-fullstack-developer-to-orchestrator-phase-01-completion-260702-2145.md:45`) says "Concerns/Blockers: none blocking" — the race was not surfaced.
- Realistic trigger: a director publishes an exercise (Trigger A) at the same moment the 30-min cron tick (Trigger B) is mid-scan for the same unit — plausible given publish actions happen during business hours when the cron is always running. Impact is a duplicate `new_exercise_open` notification (and duplicate `emitNotification` push) for the same student — a UX/data-integrity bug, not a security issue, but it directly contradicts the plan's stated "hard invariant"-adjacent claim ("Neither trigger double-notifies the other").

**Fix**: add a unique constraint (`@@unique([recipientType, recipientId, type, ...])` won't work directly since exerciseId lives in JSON payload — either add a dedicated `exerciseId` column with a unique index, or use `INSERT ... ON CONFLICT DO NOTHING` via a raw query against a real unique key), or serialize both triggers through a `SELECT ... FOR UPDATE`/advisory lock keyed on the unit or exercise. A schema change is the more robust option since the JSON-payload dedup approach can never be made atomic without one.

## Medium Priority

### 2. `dedupAndCreate` inserts one row at a time instead of the spec'd `createMany` (exercise-open-notify.ts:62-74)
The plan explicitly says "Skip matched pairs; `createMany` the rest" (phase-01 doc, "Idempotency implementation" section). The implementation instead loops `for (const c of toCreate) { await tx.notification.create(...) }` — a sequential N+1 write pattern. For Trigger B, `candidates` can span many opened units × many students per tick; each candidate is now its own round trip inside the transaction. Prisma 6.1 (this repo's pinned version, `packages/db/package.json:26`) supports `createManyAndReturn` on Postgres, which would satisfy both the "return created rows for `emitNotification`" need and the batched-insert intent of the plan. Not a correctness bug today (facility/student volumes are small per the LMS positioning), but it is a real deviation from the documented design and a latent scaling concern worth fixing while touching this file.

### 3. Plan/phase labels embedded in code and test names — violates repo rule
Per `.claude/rules/review-audit-self-decision.md` ("Stable Code Artifacts": "Do not put plan IDs, phase numbers, audit labels, or finding codes in code comments, migration names, test names, or commit messages"):
- `apps/api/src/index.ts:519` — comment `// Exercise-open notification, Trigger B (plan 6 P1): ...`
- `apps/api/test/exercise-open-notify.int.test.ts:1-2` — file header `Integration tests: Plan 6 P1 — ...`
- `apps/api/test/exercise-open-notify.int.test.ts:175` — `describe('exercise-open-notify (Plan 6 P1)', ...)`

These should describe the invariant/behavior directly (e.g., "Trigger B: session-end cron, catches publish-before-session-end ordering") rather than referencing a plan/phase label.

## Low Priority

None beyond the above.

## Trigger A / publish-latency coupling — checked, matches accepted plan risk

`exercise.ts:150-154`: `notifyForExercise(exercise.id)` runs **after** the director's `withRls` block resolves (i.e., after the publish transaction has already committed), in its own `SYSTEM_CTX` pass — confirmed not nested inside the publish transaction. It is `await`ed without a `.catch`, so if `notifyForExercise` throws (e.g., transient DB error), the exception propagates out of the `upsert` mutation and the client sees a failed RPC even though the exercise was already durably published. This is a real inconsistency between server state and client-perceived state, but it is an explicitly accepted, documented trade-off in the plan's own risk table ("Trigger A blocks the upsert request path | L×M | ... switch to fire-and-forget `.catch` if latency observed") and the plan's Files section defaults to "Await for determinism/testability." Not flagging as a deviation — flagging as a known residual risk worth watching if publish-time errors are observed in production logs.

## Test coverage notes

The 5 new integration tests are real (drive `notifyForExercise`/`runExerciseOpenNotifications` against the dev DB, assert row counts via `notifCount`), not phantom tests. They cover: publish-after-session (Trigger A), pre-existing-exercise-then-session-end (Trigger B + dedup-on-repeat), session move after notify (no dup), both triggers on the same pair (sequential, not concurrent — see Finding 1), and three negative cases. Scenario (c)/(d) both run triggers sequentially with `await`, so none of them actually validate the concurrent-race path in Finding 1 — that gap is real and untested, not just theoretical.

## Recommended Actions

1. (High) Close the TOCTOU gap in `dedupAndCreate` — add a DB-level uniqueness guard (schema change) or serialize via advisory lock; add a concurrency test (`Promise.all([notifyForExercise(id), runExerciseOpenNotifications()])` on the same pre-opened unit/exercise) that would fail against the current implementation.
2. (Medium) Replace the per-row `tx.notification.create` loop with `createManyAndReturn` to match the plan and avoid N+1 writes.
3. (Medium) Strip "Plan 6 P1" labels from `index.ts` comment and the test file header/describe block; replace with behavior-based descriptions.

## Plan TODO status
All 6 checklist items in phase-01's Todo section are functionally implemented and test-covered, except the concurrency guarantee implied by "Neither trigger double-notifies the other" is not actually enforced at the DB level — recommend the orchestrator not mark the idempotency requirement fully DONE until Finding 1 is addressed.

## Unresolved Questions
- Should the TOCTOU fix add a real `exerciseId` column + unique index on `Notification`, or is a narrower advisory-lock approach preferred given "no schema change" was a stated plan constraint? This is a scope/tradeoff decision for the plan owner, not something to resolve unilaterally.
