# Test Report: Assessment FinalGrade Published-Only Filter

**Date**: 2026-06-24 16:05  
**Task**: T6 — Add integration test for `assessment.computeFinalGrade` published grades filter  
**Test File**: `apps/api/test/assessment-final-grade-publish.int.test.ts`  
**Status**: DONE

---

## Summary

Added mutation-proof integration test verifying `computeFinalGrade` **excludes unpublished grades** from homework/test score aggregation. The test is mutation-proof: removing the `isPublished: true` filter causes the test to fail with the contaminated value (8.55 instead of 9.6).

### Test Execution Result

```
✓ test/assessment-final-grade-publish.int.test.ts (1 test)

Test Files    1 passed (1)
      Tests    1 passed (1)
   Duration    211ms
```

---

## Test Design

### Invariant Tested
**Spec Phase 2 §2.5–2.7**: `computeFinalGrade` aggregates **ONLY published grades**. Unpublished grades must be excluded from homework/test score averages.

### Fixture Strategy

**Mutation-proof numbers**: Published-only result ≠ include-unpublished result.

- **Published Grade**: Homework score = 9/10 → normalized 9.0
- **Unpublished Grade**: Test score = 2/10 → normalized 2.0
- **Qualitative Assessment**: Single pillar (communication) = 10.0
- **Program**: BRIGHT_IG (60% qualitative + 40% quantitative)

### Score Calculations

**If filter works (CORRECT behavior)**:
- homeworkAvg = 9.0 (only published HW)
- testScore = null (no published tests)
- quantScore = 9.0 (renormalized over HW only: 0.5×9.0 / 0.5 = 9.0)
- finalScore = (0.6×10 + 0.4×9.0) / 1.0 = **9.6** ✓

**If filter broken (includes unpublished)**:
- homeworkAvg = 9.0
- testScore = 2.0 (unpublished test wrongly included)
- quantScore = (0.5×9.0 + 0.3×2.0) / (0.5 + 0.3) = 6.375
- finalScore = (0.6×10 + 0.4×6.375) / 1.0 = **8.55** ✗

### Mutation Proof Verification

Removed `isPublished: true` filter from assessment.ts line 103 and re-ran test:

```
✗ test/assessment-final-grade-publish.int.test.ts (1 test | 1 failed)

AssertionError: expected 8.55 to be close to 9.6, received difference is 1.049999999999999
```

Test correctly fails when filter is removed, proving mutation coverage.

---

## Code Quality

| Aspect | Status | Details |
|--------|--------|---------|
| **Real DB** | ✓ | Uses live test database, not mocks |
| **RLS Tested** | ✓ | Uses `withRls(SUPER, ...)` for fixture setup |
| **Cleanup** | ✓ | `afterAll` removes all fixtures (FinalGrade, QualitativeAssessment, Grade, Submission, Exercise, ClassBatch, Student) |
| **Isolation** | ✓ | Uses `uniq()` for unique codes; no test interdependencies |
| **Assertions** | ✓ | 5 assertions covering returned result + stored FinalGrade fields |
| **House Style** | ✓ | Matches `star-redeem.int.test.ts` and `rls-tenancy.int.test.ts` patterns |

---

## Assertions

### Returned FinalGrade
```typescript
expect(result.finalScore).toBeCloseTo(9.6, 1);     // published-only value
expect(result.passed).toBe(true);
expect(result.complete).toBe(true);
expect(result.finalScore).not.toBeCloseTo(8.55, 1); // NOT contaminated value
```

### Stored FinalGrade
```typescript
expect(stored?.finalScore).toBeCloseTo(9.6, 1);
expect(stored?.homeworkAvg).toBeCloseTo(9.0, 1);
expect(stored?.testScore).toBeNull();              // no published test
expect(stored?.qualitativeScore).toBeCloseTo(10.0, 1);
```

---

## Code Verification

**Source**: `apps/api/src/routers/assessment.ts` line 102–105

```typescript
const grades = await tx.grade.findMany({
  where: { isPublished: true, submission: { studentId: input.studentId, archivedAt: null } },
  select: { score: true, maxScore: true, submission: { select: { exercise: { select: { type: true } } } } },
});
```

✓ Correctly filters `isPublished: true`  
✓ No defect found

---

## Notes

- Test uses real tRPC caller (`staffCaller()`) with super-admin context
- All fixtures seeded via `withRls(SUPER, ...)` to bypass RLS during setup
- Test covers both **happy path** (filter works) and **negative path** (mutation detection)
- Execution time: ~200ms (acceptable for integration test)

**Conclusion**: Code is correct; test proves the filter works as designed.
