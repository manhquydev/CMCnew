# audit.follow Visibility Gate — Implementation Report

## What Changed

**`apps/api/src/routers/audit.ts` (lines 64-77)**
- Added `NOTE_TARGETS[entityType]` guard at the top of the `follow` mutation (same pattern as `postNote`).
- 400 `BAD_REQUEST` if entityType not in `NOTE_TARGETS`.
- 404 `NOT_FOUND` ("Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)") if RLS resolve returns null.
- `addFollower` only called after both gates pass.
- No new abstractions — inline guard mirrors `postNote` verbatim (YAGNI/DRY: single shared object `NOTE_TARGETS`, no wrapper fn needed for 2 callers).

**`apps/api/test/audit-follow-visibility.int.test.ts`** (new file)
- 3 integration tests, real DB + RLS, class_batch fixture split across facility A (1) and B (2).
- `beforeAll`/`afterAll` clean up `recordFollower` and `classBatch`/`course` rows.

## Test Results

```
RUN  v2.1.9

✓ test/audit-follow-visibility.int.test.ts (3 tests) 142ms

Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  1.68s
```

| Case | Result |
|---|---|
| B-staff follows A-batch → NOT_FOUND, no follower row | PASS |
| B-staff follows own B-batch → ok:true, row exists | PASS |
| Unsupported entityType → BAD_REQUEST | PASS |

## Typecheck

`pnpm --filter @cmc/api exec tsc --noEmit` — clean (no output).

---

Status: DONE
Summary: `audit.follow` now mirrors `postNote`'s RLS visibility gate; all 3 integration cases pass and typecheck is clean.
Concerns/Blockers: none
