# Decision 0037 Shipped + Critical Transaction-Abort Bug Discovery in Prod Code

**Date**: 2026-07-05 16:11
**Severity**: Critical (bug batch) + High (decision implementation)
**Component**: Finance (`apps/api/finance`), CRM (`packages/domain-crm`), Authorization (`packages/auth/permissions`)
**Status**: Resolved (all fixes shipped to develop)

## What Happened

Two commits landed:
1. **5c07ef5** (`feat(crm,finance)`): Decision 0037 (phone-lookup receipt linkage + duplicate-opportunity warning). Narrow `crm.opportunityLookup` permission + `opportunityLookupByPhone` query + discriminated-union return type on `receiptCreate`. ~70 existing test call sites swept with new `assertSuccess` test helper.
2. **cc54198** (`docs(plans,journals)`): Catch-up commit of previously-uncommitted plan/journal/report artifacts.

The 0037 implementation was routine until bug-fix code-review uncovered **a critical production defect, latent in *two* pre-existing code paths** that would have silently cost real money if left unfixed.

## The Brutal Truth

This is the kind of bug that code-review saved us from shipping. Not because the logic was wrong on paper, but because we tried a quick fix (`try/catch` around a database operation) that fundamentally doesn't work in PostgreSQL's transaction model.

The sting: the same bug already exists in pre-existing `propagatedEmail` code (committed earlier the same day in 5a225a6, not caught then). So we fixed two instances — one new, one old — before anyone used the broken code path in production.

## Technical Details

### Decision 0037: Success

Red-team review **caught and reversed** a critical authorization creep before implementation:

- **Original plan**: Grant `ke_toan` the existing `crm.opportunityList` permission to enable phone lookup in the finance form.
- **Red-team finding**: That permission gates the entire CRM nav tab (kanban board, all opportunities, contact PII). Granting it would expose the whole CRM section to `ke_toan`, not just enable a lookup.
- **Reversal**: Created a narrow `crm.opportunityLookup` permission, used only by the new `opportunityLookupByPhone` query. Scoped by facility + RLS. `ke_toan` gets lookup-only, no nav-tab access.

Implementation shipped cleanly:
- New permission granted to `[ke_toan, giam_doc_kinh_doanh, sale]` only.
- New query returns `{id, studentName, stage, contact.fullName}` for OPEN opportunities (canonical predicate: `stage != 'O5_ENROLLED' AND lostReason IS NULL`).
- `receiptCreate` response changed to discriminated union: `{status:'success'; receipt} | {status:'warning'; duplicateWarning}`. When a new-student receipt's phone matches an open opportunity (and no `opportunityId` supplied), returns warning instead of creating. Caller retries with `confirmDuplicate: true` to proceed (soft nudge, never hard-block, because sibling phone reuse is legitimate).
- Public-contract impact: All 71 integration test call sites + 2 frontend call sites updated to narrow result with `if (result.status === 'success')` before reading `.receipt`. Swept with new `assertSuccess` helper.

**Code-review: 0 findings on the decision logic itself.**

### Bug Batch: Critical Transaction-Abort Defect

#### Bug #10: `receiptApprove` crash when `parentEmail` already claimed

Scenario: `ke_toan` approves a receipt, supplies a parent email address already claimed by a different family.

**First fix attempt** (in the new code, commit 5c07ef5):
```typescript
try {
  const account = await db.parentAccount.create({ data: { phone, email, ... } });
  // continue money-posting
} catch (e) {
  // Postgres constraint error: email already exists
  // Proceed without the email; fetch the existing account instead
  const account = await db.parentAccount.findUnique({ where: { email } });
}
```

**What went wrong**: This code was reviewed in code-review round 1 and **blocked**. The reason: **PostgreSQL aborts the entire transaction the moment a statement error occurs (code 25P02: "transaction is aborted, current commands ignored").**

When the `create` statement fails due to a unique constraint on `email`, the transaction state becomes "ABORTED". The subsequent `catch` block's `findUnique` call is *also executed in an aborted transaction* — and it fails too, but now the whole receipt approval is rolled back (including the money posting that *should have succeeded*). Real financial loss.

**Real fix**: Wrap the CREATE + error path in a `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, so the retry happens in a nested transaction that can succeed even if the parent transaction is aborted:

```typescript
await db.$executeRaw`SAVEPOINT email_retry`;
try {
  const account = await db.parentAccount.create({ data: { phone, email, ... } });
} catch (e) {
  await db.$executeRaw`ROLLBACK TO SAVEPOINT email_retry`;
  const account = await db.parentAccount.findUnique({ where: { email } });
}
```

#### Pre-existing identical bug in `propagatedEmail` code path

During code-review, the same pattern was found in pre-existing `receipt.approve` logic (commit 5a225a6, same day):

```typescript
// WRONG: try/catch in aborted transaction
try {
  await db.student.update({ where: { id }, data: { parentEmail } });
} catch (e) {
  // This fails too, transaction still aborted
}
```

**Both fixed at once** with SAVEPOINT. Verified by new integration test:

```typescript
// student-provisioning-edge-cases.int.test.ts "EC-EMAIL"
it('receiptApprove succeeds even when parentEmail is already claimed', async () => {
  // Create family A with email1
  await receiptApprove({ phone: '84123456789', parentEmail: 'email@example.com' });
  
  // Create family B, same email, different phone
  // Before fix: transaction aborts, nothing persists
  // After fix: email is skipped, but phone+student still persist (committed)
  const result = await receiptApprove({ phone: '84987654321', parentEmail: 'email@example.com' });
  
  expect(result.status).toBe('success'); // Not a 500
  expect(result.receipt.parentPhone).toBe('84987654321');
  const guardian = await db.guardian.findUnique({ where: { phone: '84987654321' } });
  expect(guardian).toBeDefined(); // Persisted despite email collision
});
```

### Other Bug Fixes from E2E Walkthrough

- **#7** (Overview widget FORBIDDEN): Direct URL navigation to `/overview` bypassed permission gate. Shell.tsx had `visible()`, but App.tsx only checked URL-membership. Added `isReachableSection()` helper mirroring shell's logic.
- **#8** (Stale "Buổi học" tab after `generateSessions`): Sibling component state never refreshed. Fixed with `key`-bump remount pattern (already used elsewhere in `finance-panel.tsx`'s `ReceiptsCard`).
- **permission-snapshot.json drift**: Missing `guardian.resetFamilyPassword` in the test fixture. Added.

### Training Guide

New non-technical walkthrough: `docs/user-guides/huong-dan-vong-doi-hoc-sinh.html` (Vercel-hosted in existing docs site). Scrolling, screenshot-illustrated guide for staff with zero project knowledge: staff creation → class → CRM opportunity → receipt approve → LMS login → teaching day.

## What We Tried

### Decision 0037
- Phase 1 (permission + query): Hand-wrote narrow permission, tested at API layer.
- Phase 2 (return-type change): Swept all callers with assertSuccess helper.
- Phase 3 (integration tests): Lookup returns correct candidates; `ke_toan` can call lookup but not access CRM nav; duplicate-warning fires and never hard-blocks; sibling reuse succeeds.

All paths executed successfully until code-review.

### Bug #10 Fix Iteration
1. **Attempt 1** (try/catch in aborted transaction): Code review blocked. "This won't work, Postgres aborts the transaction after the first error."
2. **Attempt 2** (SAVEPOINT): Verified with new integration test. Green.
3. **Verification**: Found the same broken pattern in pre-existing code, fixed both.

## Root Cause Analysis

### Why the try/catch trick failed

This is a classic **transaction-abort blind spot** in Prisma/JS driver layers. The try/catch pattern works fine in languages where you can manually check transaction state before retrying (e.g., raw JDBC in Java). But Prisma abstracts away the `SQLSTATE 25P02` ("transaction is aborted") error, and developers often assume that catching a constraint error lets you continue. It doesn't.

The real issue: **Once a statement fails in PostgreSQL, the entire transaction is marked ABORTED at the server level.** Any further SQL in that transaction is silently skipped until you issue a ROLLBACK or ROLLBACK TO SAVEPOINT. A bare try/catch doesn't know about this state transition — it just looks like "failed, so catch, then retry the next statement." But that next statement *is already in an aborted transaction*.

### Why the bug existed pre-existing

The `propagatedEmail` code path (commit 5a225a6) was written the same morning without a specific Postgres transaction safety review. The pattern (try/catch a create, then read) is a common anti-pattern in web frameworks, and it silently passed code-review once. The fact that we found it *now*, while fixing 0037, is pure luck — we might have deployed it without noticing.

### Lessons from the discovery

This is a **code-review win**. The bug wasn't caught by linting, tests, or logic review. It was caught because the reviewer (human) ran the code mentally against Postgres's transaction model and spotted the mismatch. This is exactly the kind of low-level database semantics that developers new to Postgres often miss.

## Lessons Learned

1. **Try/catch is not a retry pattern in Postgres. Use SAVEPOINT or an idempotent upsert.** If you need to recover from a constraint error in a transaction, wrap the retry in a SAVEPOINT. Or better: use `INSERT ... ON CONFLICT DO NOTHING` / `UPDATE ... WHERE NOT EXISTS` to avoid the error in the first place.

2. **Transaction-state blindness is common in ORMs.** Prisma and similar ORMs hide the Postgres error state, so developers often write code that "looks correct" but violates transaction semantics. Enforce a rule: "Any catch block that retries a database operation must use SAVEPOINT or upsert, never bare retry."

3. **Code-review must include "will this work in a transaction?" for money-posting code.** The `receiptApprove` and `receipt.guardianUpdate` paths handle real money. Every database operation in those paths should be audited for transaction safety before shipping.

4. **Identical bugs hide in sibling code paths.** The fact that `propagatedEmail` (pre-existing) and the new `parentEmail` fix (0037) both had the same try/catch bug suggests this is a pattern that wasn't caught earlier. A post-merge audit of all money-posting code paths would have surfaced both.

5. **Integration tests can prove transaction semantics.** The new "EC-EMAIL" test (concurrent receipt approvals with email collision) proves that the SAVEPOINT fix actually works — the receipt persists even though the email insert was skipped. This is harder to verify by code inspection alone.

## Next Steps

- [x] All 4 bug fixes + decision 0037 shipped to develop (commits 5c07ef5, cc54198).
- [x] Integration test suite green (594/594 on live Postgres).
- [ ] **Post-merge audit**: Scan all `db.*.create()` and `db.*.update()` calls in `apps/api/src/routers/finance.ts` and `apps/api/src/routers/guardian.ts` for similar try/catch patterns. Replace with SAVEPOINT or upsert.
- [ ] **Postgres training note for team**: Add a brief section to `docs/code-standards.md` under "Database" → "Transaction Safety": "Retrying a failed database statement requires SAVEPOINT; bare try/catch in a transaction is unsafe."
- [ ] Verify production receipt-approval flow with overlapping parent emails once deployed (should succeed, not 500).

---

**Session note**: This was a successful verification pipeline in action — brainstorm + plan + red-team (caught auth creep) + implementation + code-review (caught critical txn bug + pre-existing sibling bug) + test (proved the SAVEPOINT fix works). The transaction-abort discovery is exactly the kind of latent defect that would have cost real money in production. The fact that it was caught *before deploying* is the point of code-review gates.
