# class-close-cancels-future-meetings — Implementation Report

## Files Modified

| File | Change |
|---|---|
| `apps/api/src/routers/class-batch.ts` | +26 lines: added `cancelFutureParentMeetings` helper, wired into `setStatus` and `cancel` |
| `apps/api/test/class-close-cancels-future-meetings.int.test.ts` | new file, 128 lines, 2 integration tests |

## Changes Summary

### `apps/api/src/routers/class-batch.ts`

- **Line 4**: `import type { Prisma } from '@cmc/db'` — needed for `Prisma.TransactionClient` parameter type.
- **Lines 11–24**: `TERMINAL_STATUSES` constant + `cancelFutureParentMeetings(tx, classBatchId, now)` helper — single `updateMany` on `parentMeeting` filtering `{ status: 'scheduled', archivedAt: null, scheduledAt: { gte: now } }`, returns count.
- **Lines 103–119** (`setStatus`): after status update, checks `nowTerminal && !wasTerminal`; if true, computes `now` as start-of-day (matches session-cancel convention), calls helper, logs `note` event when count > 0.
- **Lines 143–144** (`cancel`): calls helper alongside existing `classSession.updateMany`; folds meeting count into the existing note string.

### Test file

- `beforeAll`: seeds one course, two batches (`running`), three meetings (future + past on batch1, future on batch2). All seed with `facilityId: FAC` as required by schema.
- Test 1: `setStatus(closed)` → future meeting → `cancelled`; past meeting → still `scheduled`.
- Test 2: `cancel(reason)` → future meeting → `cancelled`.
- `afterAll`: guards undefined IDs with `.filter(Boolean)` before Prisma array args to avoid validation error when `beforeAll` fails mid-way.

## Test Results

```
RUN v2.1.9 D:/project/CMCnew/apps/api

✓ test/class-close-cancels-future-meetings.int.test.ts (2 tests) 198ms

Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  1.60s
```

TypeCheck: `pnpm --filter @cmc/api exec tsc --noEmit` — clean (no output).

## Residual Concerns

None. `cancel` mutation return type now includes `cancelledMeetings` — callers consuming the raw return value will see the extra field (additive, non-breaking for tRPC clients that don't destructure it).

---

Status: DONE
Summary: Helper `cancelFutureParentMeetings` added; wired into both `setStatus` (terminal guard) and `cancel`; 2 integration tests pass; typecheck clean.
