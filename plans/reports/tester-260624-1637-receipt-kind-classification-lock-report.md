# QA Report: Receipt Kind Classification Integration Test

**Task:** Lock the accepted history-based `kind` classification behavior (backlog T5) with an integration test to prevent future regressions.

**Scope:** New integration test file `apps/api/test/receipt-kind-classification.int.test.ts`

---

## Test Results

✓ All tests PASS  
- Test Files: 1 passed (1)  
- Tests: 3 passed (3)  
- Duration: 334ms  
- Run command: `pnpm --filter @cmc/api test:int receipt-kind-classification`

### Test Output (Complete PASS)
```
✓ test/receipt-kind-classification.int.test.ts (3 tests)

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  16:37:20
   Duration  1.60s
```

---

## Behavior Locked (Code Condition Confirmed)

From `apps/api/src/routers/finance.ts` lines 235–245, the exact derivation logic:

```typescript
// Line 239–241: Load opportunity if linked
const opp = receipt.opportunityId
  ? await tx.opportunity.findUnique({ where: { id: receipt.opportunityId }, select: { ownerId: true, stage: true } })
  : null;

// Line 242–244: Count prior collected/approved/sent/reconciled receipts for this student
const priorCollected = await tx.receipt.count({
  where: { studentId: receipt.studentId, id: { not: receipt.id }, status: { in: ['approved', 'sent', 'reconciled'] } },
});

// Line 245: The decision rule
const kind = opp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected > 0 ? 'renewal' : 'new';
```

**Decision tree:**
1. If receipt linked to opportunity WITH `stage === 'O5_ENROLLED'` → `kind = 'new'` (covers first-time + win-back via fresh funnel)
2. Otherwise (NO opportunity OR opportunity stage ≠ O5_ENROLLED):
   - If student has ≥1 prior receipt in status [approved|sent|reconciled] → `kind = 'renewal'`
   - Else → `kind = 'new'`

---

## Test Coverage

### Case A: Renewal (History Fallback)
**Test:** "receipt with NO opportunityId + student HAS prior approved receipt → kind = 'renewal'"

- Seed: student + 1 prior approved receipt
- Create: 2nd receipt with NO opportunityId
- Approve: derived kind = 'renewal' ✓

**Mutation-proof:** If history lookup is removed or broken, this would incorrectly be 'new' instead of 'renewal'.

### Case B: New (Fresh Student)
**Test:** "receipt with NO opportunityId + student has NO prior receipt → kind = 'new'"

- Seed: fresh student with 0 receipts
- Create: receipt with NO opportunityId
- Approve: derived kind = 'new' ✓

**Mutation-proof:** If history is checked even when it shouldn't be, this could be corrupted to 'renewal'.

### Case C: Mutation-Proof Differential
**Test:** "the two cases produce DIFFERENT kinds (A=renewal, B=new)"

- Both students created independently
- Student A: has prior approved receipt → 2nd receipt (no opp) → kind = 'renewal'
- Student B: NO prior receipt → 1st receipt (no opp) → kind = 'new'
- Assert: `approvedA.kind !== approvedB.kind` ✓

**Why this locks the behavior:** If the history fallback is removed (both become 'new'), or if the condition is inverted (both become 'renewal'), the test fails immediately.

---

## Implementation Notes

- **No opportunityId tests:** All three cases explicitly test the NO-opportunity fallback path (the history derivation). The case with O5_ENROLLED opportunity is already covered by `commission-for-sale-e2e.int.test.ts`.
- **Fixture cleanup:** All receipts, students, and the shared course are deleted in `afterAll()`, respecting FK constraints (receipts first, then students, then courses).
- **Student isolation:** Each test case creates its own student to avoid cross-test contamination. The `uniq()` helper ensures unique student codes across parallel/retry runs.
- **Status filter:** The count checks only receipts in [approved|sent|reconciled] status, matching the exact Prisma condition in the source code.

---

## Files

**Created:**
- `D:\project\CMCnew\apps\api\test\receipt-kind-classification.int.test.ts` (192 lines)

**Not modified:**
- `apps/api/src/routers/finance.ts` (no change; behavior already committed)
- Test setup/helpers reused from existing patterns

---

## Conclusion

Status: **DONE**

The exact code condition is locked by three mutation-proof test cases. Any future regression in the history fallback will be caught immediately. The behavior matches the accepted decision from the project owner: receipts with no linked opportunity derive `kind` from prior receipt history (renewal if prior exists, new otherwise).

Unresolved questions: None.
