# Code Review Report — Correctness / Regression / Security
**Reviewer:** #1 (Correctness / Regression / Security)
**Branch:** `test/invariant-integration-harness` → `main` (5 commits, not yet pushed)
**Date:** 2026-06-24

---

## Scope

| File | Nature |
|---|---|
| `apps/api/test/*.int.test.ts` (8 files, new) | Integration test harness |
| `apps/api/test/helpers.ts` (new) | Test utilities |
| `apps/api/test/setup.ts` (new) | Vitest setup / env loading |
| `apps/api/vitest.integration.config.ts` (new) | Vitest integration config |
| `apps/teaching/src/crm-panel.tsx` (modified) | Chatter modal on opportunity |
| `apps/teaching/src/finance-panel.tsx` (modified) | Chatter modal on receipt |
| `.github/workflows/ci.yml` (modified) | CI gate additions |

**Production source (`apps/api/src`) was NOT modified in this branch. Confirmed by `git diff main..HEAD --name-only`.**

---

## Overall Assessment

The integration harness is structurally sound and materially improves regression coverage. Tests use real Prisma + tRPC callers against a live DB, not mocks. Invariant assertions are specific and non-trivial. No wholesale phantom-green patterns (no empty asserts, no swallowed exceptions, no unawaited assertions found).

Two medium-severity issues need attention before merge. No HIGH/critical blocking issues found.

---

## Critical Issues

None.

---

## High Priority

None.

---

## Medium Priority

### MED-1 — Cross-facility note injection via `audit.postNote` with `facilityId: null`
**File:** `apps/api/src/routers/audit.ts:21–43` (pre-existing, but newly exercised surface)
**Triggered by:** `f68e56b` (Chatter component wired to CRM + Finance panels)

**FACT:** `postNote` accepts `facilityId` as `z.number().int().positive().nullish()` — the caller supplies it directly with no server-side ownership verification. The RLS `WITH CHECK` on `record_event` allows `facility_id IS NULL`, so any authenticated staff user can call:

```ts
trpc.audit.postNote.mutate({ entityType: 'receipt', entityId: '<any-uuid>', facilityId: null, body: 'injected note' })
```

This writes a `facility_id = NULL` row which, per the RLS `USING` clause (`... OR facility_id IS NULL ...`), is readable by ALL staff across all facilities in `audit.timeline`. The result: an authenticated staff member from facility B can (a) post a note on any entity UUID they know (even one owned by facility A) and (b) that note surfaces in the entity's timeline to facility A's staff.

**JUDGMENT:** This is an integrity defect, not a full data-exposure breach (authN is required; RLS blocks reading A's non-null events from B). But it enables cross-facility timeline pollution and may introduce confusing audit trail entries. It pre-exists this branch but the Chatter feature activates the surface for non-super-admin users at scale.

**Fix path:** On the server in `postNote`, resolve `facilityId` from the entity record itself (lookup the entity by type+id inside the `withRls` call) rather than trusting the caller-supplied value. Alternatively, validate that the caller's `facilityIds` contains the supplied `facilityId` before writing.

---

### MED-2 — `audit.timeline` load errors swallowed silently in `Chatter`
**File:** `packages/ui/src/chatter.tsx:46`
**Triggered by:** `f68e56b`

**FACT:**
```ts
const load = useCallback(() => {
  trpc.audit.timeline
    .query({ entityType, entityId })
    .then((r) => setEvents(r as TimelineEvent[]))
    .catch(() => {}); // ← swallows all errors
}, [entityType, entityId]);
```

If `timeline` returns `UNAUTHORIZED`, network error, or any other failure, the UI silently shows "Chưa có hoạt động." This makes auth failures indistinguishable from a legitimately empty timeline. In the Chatter context (staff modal), the user has no way to know the load failed.

**Fix path:** Replace `.catch(() => {})` with `.catch((err) => setLoadError(err))` and render an error message in the component.

---

## Low Priority

### LOW-1 — `level-progress-authz` tests have implicit execution-order dependency
**File:** `apps/api/test/level-progress-authz.int.test.ts:183–235`

**FACT:** Test #2 (`non-head_teacher decide`) and Test #3 (`head_teacher approves`) both `findFirstOrThrow({ where: { studentId, status: 'pending' } })` — they depend on Test #1 (`teacher proposes`) having run first and the proposal still being pending. Vitest runs `it` blocks in declaration order within a describe, so this works in practice. However, no `beforeAll` guard explicitly creates the proposal; the state is carried implicitly across `it` blocks.

**JUDGMENT:** Not a bug today, but fragile. If the test suite is ever randomized or if test #2 is run in isolation, it will fail with a confusing `findFirstOrThrow` error rather than a meaningful skip or setup error. For a P0 harness this is a low-risk maintenance debt, not a blocker.

**Suggestion:** Extract the initial `propose` into `beforeAll` and store the `lpId`, making each `it` block self-contained with respect to which LP it acts on.

---

### LOW-2 — `parent-meeting-cadence` uses relative comparison for dedup assertion
**File:** `apps/api/test/parent-meeting-cadence.int.test.ts:312–313`

**FACT:**
```ts
expect(second.meetingsReminded).toBeLessThan(first.meetingsReminded);
```

This assertion relies on `first.meetingsReminded >= 1` (our test meeting was reminded) and that the second tick is strictly fewer. If the integration DB happens to have other meetings in the `[now, now+24h]` window that encounter an error mid-reminder (partial batch failure), those meetings would not get `remindedAt` set, would appear in the second tick but not the first, and `second` could equal or exceed `first`. This is a very unlikely scenario in CI, but the invariant being tested (our specific meeting's `remindedAt` is not overwritten) is already asserted directly on line 311:

```ts
expect(stampedAtAfter).toEqual(stampedAt);
```

The `meetingsReminded` count comparison is redundant and weaker. It can be removed or replaced with a direct assertion that the second tick's result did NOT include our meeting's ID (if `runReminders` returned per-meeting IDs, which it currently doesn't).

**JUDGMENT:** The primary dedup invariant IS correctly asserted (line 311). The secondary count assertion adds noise risk without material coverage gain.

---

### LOW-3 — `star-redeem.int.test.ts` races two calls from the same `lmsCaller` instance
**File:** `apps/api/test/star-redeem.int.test.ts:643–645`

**FACT:**
```ts
const caller = lmsCaller(studentLms());
const results = await Promise.allSettled([
  caller.rewards.redeem({ giftId }),
  caller.rewards.redeem({ giftId }),
]);
```

Both calls share the same in-process `lmsCaller`. The `appRouter.createCaller` bypasses HTTP entirely and calls procedures directly. Concurrency depends on whether Prisma opens separate DB connections per `$transaction` call. In Prisma's connection pool, each `$transaction` acquires its own connection, so the two calls do race at the DB level — the `pg_advisory_xact_lock` (transaction-scoped) will serialize them correctly.

**JUDGMENT:** The test correctly exercises the lock. However, the test comment says "advisory lock serialises the two, so the loser is deterministically blocked at the **stock check** (BAD_REQUEST)" — but the first thing the loser does inside the lock is `findUniqueOrThrow` on the gift, then `findMany` on transactions, then `checkRedeem(balance, gift)`. Since `gift.stock` is already 0 (committed by the winner), `checkRedeem` returns `out_of_stock` → BAD_REQUEST. This is correct, and the assertion `expect(reason.code).toBe('BAD_REQUEST')` is valid.

The minor concern: if for any reason the lock doesn't serialize (e.g., they don't both enter the same `$transaction` block), the loser would hit the `updateMany` backstop and throw `CONFLICT` instead of `BAD_REQUEST`, failing the test. This would correctly indicate the advisory lock is broken — the test distinguishes lock-failure mode (CONFLICT) from lock-success mode (BAD_REQUEST), which is good test design. No change needed.

---

## Positive Observations (risk-calibration only)

- **No production code modified.** All 5 commits are test infrastructure + one UI feature addition. Regression risk to the API is zero from this branch.
- **Tests use real tRPC callers, real DB transactions, and real RLS.** The `withRls(SUPER, ...)` for fixture setup and `withRls(bScope, ...)` for assertions directly exercises the same code paths production uses. These are not re-implementations of business logic.
- **Race condition tests are structurally correct.** `Promise.allSettled` on distinct Prisma transactions gives genuine DB-level concurrency for the advisory lock and voucher CAS tests.
- **Cleanup (`afterAll`) covers FK children** in the level-progress and reward tests (notifications, certificates deleted before the student/LP rows). No dangling FK errors expected.
- **CI yml is correct.** `cmc_app` role is created in migration (verified), seed runs before integration tests, `CRM_LEAD_TOKEN` is set, and `vitest run --config vitest.integration.config.ts` uses the correct serial/single-fork config.
- **`uniq()` prefix strategy** (`${prefix}_${process.pid}_${Math.floor(performance.now())}`) provides sufficient collision resistance for parallel re-runs in CI.

---

## Unresolved Questions

1. **MED-1 ownership enforcement:** Is the intended design for `postNote` to trust the caller-supplied `facilityId`, relying solely on RLS? If so, the NULL-facilityId injection path should be documented as an accepted risk. If not, server-side verification is needed.
2. **`audit.timeline` authorization scope:** `protectedProcedure` allows any staff session to query any `entityId`. Is there a planned access check to limit timeline queries to entities within the caller's facility scope? RLS on `record_event` partially covers this (non-null facility events are filtered), but the design relies on staff never learning UUIDs from other facilities — which is fragile in a multi-facility deployment.
3. **Test teardown vs test DB:** If integration tests are run against a shared dev DB (not a throw-away CI instance), the `afterAll` cleanup is FK-order-dependent and will silently leave orphan rows if a test assertion fails mid-suite. Is the integration DB expected to be ephemeral (CI-only) or shared?

---

Status: DONE_WITH_CONCERNS
Summary: Integration harness is structurally sound with real assertions against live DB; no phantom-green tests found. Two medium issues require attention: `postNote` allows NULL-facilityId note injection across facility boundaries (MED-1), and Chatter silently swallows timeline load errors with no UI feedback (MED-2).
Concerns: MED-1 (cross-facility note pollution via facilityId=null in postNote), MED-2 (Chatter error suppression makes authz failures invisible to staff users)
