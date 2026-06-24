# Decouple Level-Up from Auto-Certificate — Implementation Report

Date: 2026-06-24
Decision: 0008 — LMS là nền làm bài tập; chứng chỉ cấp tay, bỏ auto theo level-up

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/routers/level-progress.ts` | Removed auto-cert block (lines 104–129); `const student =` → bare `await` |
| `apps/api/test/level-up-no-auto-certificate.int.test.ts` | NEW — inverted invariant + manual-issue case |
| `apps/api/test/level-up-certificate.int.test.ts` | DELETED |

## Diff Summary

### level-progress.ts

Removed from `decide` mutation (approved branch):
- Comment explaining auto-cert rationale
- `tx.certificate.findFirst` idempotency check
- `tx.certificate.create` with program/level/title/issuedById
- `logEvent` for `certificate` / `created`
- `const student =` binding (now bare `await tx.student.update(...)`)

Kept intact:
- `tx.student.update` (level promotion)
- `tx.notification.create` (type `level_up`)
- `logEvent` for `level_progress` / `status_changed`
- SSE emit via `emitNotification`

### Test invariant: old → new

| Invariant | Old (`level-up-certificate.int.test.ts`) | New (`level-up-no-auto-certificate.int.test.ts`) |
|-----------|------------------------------------------|--------------------------------------------------|
| approve → cert count | 0 → 1 (PASS = auto-cert created) | stays 0 (PASS = no auto-cert) |
| approve → Student.level | L1 → L2 (asserted) | L1 → L2 (still asserted) |
| manual certificate.issue | not tested | 0 → 1 (new case) |
| mutation-proof | adding cert in router makes old test pass | removing cert from router makes new test fail |

## Test Output

```
Test Files  19 passed (19)
      Tests  72 passed (72)
   Duration  8.48s
```

File `test/level-up-no-auto-certificate.int.test.ts`: 3 tests PASS
- before approval: zero certificates for this student
- head_teacher approves level-up → Student.level updated to L2, certificate count stays 0
- manual certificate.issue (head_teacher) → creates exactly 1 certificate, cert count 0 → 1

No regressions. Test count unchanged (3 new cases replace 3 old cases from deleted file).

## Quality Gates

- Typecheck: PASS (tsc --noEmit, no errors)
- Lint: PASS (eslint src, no warnings)
- Integration tests: 72/72 PASS
