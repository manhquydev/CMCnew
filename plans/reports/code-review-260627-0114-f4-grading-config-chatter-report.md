# F4 Review — DB Grading Weights · Term Lock · Chatter

Date: 2026-06-27
Reviewer: code-reviewer (staff prod-readiness pass)
Scope: uncommitted `git diff HEAD` on `feature/erp-unify-rbac-f0`
Mode: READ-ONLY (no edits)

## VERDICT: FIX-FIRST — 1 blocker

The parity claim is FALSE for any database built through the canonical seed path. The
term-lock and Chatter work are sound. One critical grading-correctness regression must be
fixed before ship.

---

## Files reviewed
- `packages/domain-grading/src/grading.ts` (weights override)
- `apps/api/src/routers/assessment.ts` (termLock/termUnlock, lock gate, DB weights)
- `apps/api/src/routers/audit.ts` (chatter student target + fan-out)
- `apps/api/src/lib/emit-staff-notif.ts`
- `packages/db/prisma/schema.prisma` + migration `20260627020000_grading_weights_term_lock`
- `packages/db/src/seed-demo.ts`
- `packages/auth/src/permissions.ts` + `permission-snapshot.json`
- 3 new tests (parity / term-lock / chatter)

---

## CRITICAL

### C1 — Fresh-seeded BRIGHT_IG / BLACK_HOLE templates mis-grade (qualitative-only). Parity claim is false.
Files: `packages/db/prisma/migrations/.../migration.sql` (Step 1–2), `packages/db/src/seed-demo.ts:64`, `apps/api/src/routers/assessment.ts:238-254`

The migration adds the columns with **column defaults `qualitative_weight=1.0`,
`quantitative_weight=0.0`** (correct only for UCREA), then back-fills *existing* rows to
charter values. That back-fill is a one-time fix for rows present at migration time.

The only code path that creates `GradingTemplate` rows is `seed-demo.ts:64`, and it does
**not** set the weight columns:
```ts
await prisma.gradingTemplate.create({
  data: { facilityId: hq.id, program, formula: {...}, criteria: {...}, thresholds: {...} },
  // qualitativeWeight / quantitativeWeight omitted → DB default 1.0 / 0.0
});
```
So on any DB seeded from scratch (the normal path), all three programs' templates carry
`1.0 / 0.0`. `computeFinalGrade` at `assessment.ts:243-253` now reads those template weights
and passes them as `weights`, which **override** `programWeights()`:
```ts
const w = input.weights ?? programWeights(input.program);  // grading.ts:94
```
Result: BRIGHT_IG computes as 100% qualitative (charter: 60/40) and BLACK_HOLE as 100%
qualitative (charter: 30/70). Before F4 these used the correct hardcoded charter weights.
**F4 introduces a silent grading regression for two of three programs.**

Why the parity test misses it: `grading-weights-db-parity.int.test.ts` hand-copies
`DB_WEIGHTS` as literals equal to `programWeights()` and feeds them to the function. It
proves `computeFinalGrade(weights==programWeights) === computeFinalGrade(no weights)` —
near-tautological given line 94 — and a sanity check that the literals match
`programWeights()`. It never reads a migrated/seeded row, so it cannot detect that the
actual stored weights are `1.0/0.0`. The test is structurally non-vacuous but guards the
wrong boundary; it certifies parity that the real seed path does not deliver.

Fixes (any one closes the correctness gap; do the first two):
1. Set weights explicitly in `seed-demo.ts` per program (UCREA 1/0, BRIGHT_IG 0.6/0.4,
   BLACK_HOLE 0.3/0.7), mirroring `programWeights()`.
2. Change the column default to be non-authoritative or make weights non-nullable with no
   default so every create must supply them. (At minimum stop relying on `1.0/0.0` as a
   silent default for non-UCREA.)
3. Make the parity test a true integration test: seed templates via the real path, then
   read `qualitativeWeight/quantitativeWeight` back from the DB and assert they equal
   `programWeights(program)` for all three programs. As written it gives false confidence.

Note: migration SQL back-fill values themselves are correct and match `programWeights()`
exactly (UCREA 1.0/0.0, BRIGHT_IG 0.6/0.4, BLACK_HOLE 0.3/0.7). `computeFinalGrade` is
unchanged when `weights` is omitted. The defect is the default + seed, not the migration
literals or the function.

---

## MEDIUM

### M1 — Lock gate is read-then-write across a non-serialized boundary (TOCTOU)
File: `assessment.ts:185-196` then `:267`

`computeFinalGrade` reads `term.isLocked` and later upserts `FinalGrade` in the same
`withRls` tx, but under READ COMMITTED a concurrent `termLock` that commits between the
read and the upsert will not be seen — the grade still writes after the term is locked.
Window is small and impact low (one stale recompute at the instant of locking), but if you
want the lock to be a hard invariant, take a row lock on the term
(`SELECT ... FOR UPDATE`) or re-check `isLocked` immediately before the upsert. Acceptable
to defer given the threat model (admin locking exactly as a teacher recomputes is rare).

### M2 — Lock only freezes FinalGrade, not its inputs
Files: `assessment.ts` `upsertQualitative` (and grade/attendance write paths)

`isLocked` blocks `computeFinalGrade` only. `upsertQualitative`, grade publishing, and
attendance remain mutable in a locked term. Stored `FinalGrade` rows are frozen (good), but
underlying inputs can still drift, so "locked" is weaker than it may read to an operator.
If the intent is a full period close, gate `upsertQualitative` on `isLocked` too. If the
intent is only "freeze the final number," document that and leave as-is. Confirm intent.

---

## LOW / INFORMATIONAL

- L1 — `getTimeline`/`getFollowers`/`getFollowers` fan-out: `record_event` and
  `record_follower` have no `facility_id` RLS of their own. Tenant safety is enforced by the
  `NOTE_TARGETS` entity pre-check in `audit.ts` (resolve via RLS → null = NOT_FOUND) before
  any timeline/follower/postNote access. The new `student` target follows that pattern
  correctly (`audit.ts:20`). Fan-out recipients come from `getFollowers` on the same
  already-authorized entity and exclude the author; `facilityId` is taken from the record,
  not the client. No cross-facility leak found. Caveat: a follower who has since lost access
  to a facility still receives the SSE row (followers list isn't re-authorized at fan-out).
  Low risk; note for later.
- L2 — Chatter test `chatter-timeline-student.int.test.ts` asserts timeline/isolation/
  NOT_FOUND/BAD_REQUEST but does **not** assert the follower fan-out / `chatter_note`
  StaffNotification rows — the headline new behavior in `postNote` is untested. Add a case
  that a second follower receives a `chatter_note` notification and the author does not.
- L3 — `emitStaffNotif` correctly persists inside tx and defers `push()` until after commit;
  rollback-then-ghost-SSE is avoided. Good. `push()` is fire-and-forget (no await) — fine
  since it only writes to in-memory SSE channels.
- L4 — Permission parity: `termLock`/`termUnlock` added to both `permissions.ts` and
  `permission-snapshot.json` with identical `["head_teacher","quan_ly"]`, matching
  `termCreate`/`termUpdate`. Snapshot stays consistent. termLock/termUnlock auth gate is the
  same `requirePermission('assessment', ...)` as siblings. Consistent.

---

## Task-checklist results
1. Grading parity: **FAIL** — test non-vacuous but guards wrong boundary; real seed path
   diverges from charter for BRIGHT_IG/BLACK_HOLE (C1). Migration literals correct;
   `computeFinalGrade` unchanged when weights omitted.
2. Term lock: only one prod grade-write path exists (`assessment.ts:267` FinalGrade upsert;
   `verify-grading-rls.ts` is a script). It is gated by the `isLocked` check. No bypass.
   Same-tx but not row-locked (M1). Inputs not frozen (M2).
3. termLock/termUnlock auth + snapshot: consistent, parity preserved (L4).
4. Chatter RLS: facility-scoped via entity pre-check; fan-out stays in scope (L1). Fan-out
   itself untested (L2).
5. Typecheck/lint: not run (read-only, time). Changes are type-clean by inspection;
   `ProgramWeights` is exported from `@cmc/domain-grading` index and imported as a type.

## Unresolved questions
- Is `seed-demo.ts` the production template-provisioning path, or do prod facilities get
  templates another way? If another way, does it set weights? This determines whether C1 is
  CRITICAL-in-prod or CRITICAL-in-demo-only (still a blocker for correctness either way).
- Is a locked term meant to freeze only the final number (current) or the whole period
  including qualitative inputs (M2)?
