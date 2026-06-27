# Code Review: Parent-Meeting Backlog Batch (b39266e^..HEAD)

**Commits reviewed:** b39266e, 1e9ddb7, 13ddf5e, 3bea963
**Date:** 2026-06-24
**Reviewer:** code-reviewer subagent

---

## Findings

---

### CRITICAL — Reminder fires for time-TBD meetings, sending parents a "00:00" phantom alarm

**Commit:** 3bea963
**File:** `apps/api/src/services/parent-meeting-reminder.ts:23`

**Root cause:**
Auto-generated meetings created by `parentMeetingSchedule` (via `addMonthsUtc`) get `scheduledAt = midnight UTC` (e.g. `2026-09-15T00:00:00.000Z`) and `timeConfirmed = false`. The reminder query is:

```ts
where: { status: 'scheduled', remindedAt: null, archivedAt: null,
         scheduledAt: { gte: now, lte: horizon } }
```

There is no `timeConfirmed: true` filter. When the cron runs ~24 h before a TBD meeting's placeholder midnight UTC time, that meeting falls within `[now, now+24h]` and a reminder is dispatched. The notification payload includes `scheduledAt: m.scheduledAt.toISOString()` — parents receive a reminder for a meeting at "00:00" that has not yet been scheduled by staff. Once `remindedAt` is stamped, the dedup flag fires and no second reminder can be sent after the actual time is confirmed via `setSchedule`.

**Compound harm:**
1. Parents get a confusing notification at an invented time.
2. After `setSchedule` sets the real time, `remindedAt` is already set → the proper T-1 reminder never fires.

**Fix:** Add `timeConfirmed: true` to the reminder query filter.

```ts
// parent-meeting-reminder.ts line 23
where: {
  status: 'scheduled',
  remindedAt: null,
  archivedAt: null,
  timeConfirmed: true,          // ← add this
  scheduledAt: { gte: now, lte: horizon },
},
```

No migration needed; column already exists with `DEFAULT false`.

---

### HIGH — `audit.followers` endpoint returns cross-facility user IDs (pre-existing, made reachable by commit b39266e)

**Commit:** b39266e
**File:** `apps/api/src/routers/audit.ts:28-32` + `packages/audit/src/index.ts:113-115`

**Root cause:**
`record_follower` has no RLS (explicitly noted in the academic-core migration comment: "record_follower is non-sensitive metadata → no RLS"). The `followers` endpoint does not gate on entity visibility before returning the follower list:

```ts
followers: protectedProcedure
  .input(z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }))
  .query(({ ctx, input }) =>
    withRls(rlsContextOf(ctx.session), (tx) => getFollowers(tx, input.entityType, input.entityId)),
  ),
```

`getFollowers` queries `record_follower` which has no RLS. A staff member of facility B can call `audit.followers` with an entityId belonging to facility A and receive a list of `userId` values from that entity. This leaks internal user IDs across facility boundaries.

This is NOT introduced by commit b39266e; the `follow` mutation is the new code. However, `postNote` (also in the file) already existed with the same entity-resolution guard but `followers` still lacks it. Commit b39266e adds the fix to `follow` but leaves `followers` and `timeline` unguarded for entity-level visibility.

Note: `timeline` queries `record_event` which has facility-scoped RLS, so cross-facility events are hidden automatically. Only `followers` is the real gap.

**Actual exposure:** `userId` UUIDs only — no PII, no content. Severity is HIGH rather than CRITICAL, but it is a trust-boundary violation (cross-facility information leak).

**Fix:** Add the same NOTE_TARGETS resolve+check pattern to the `followers` query handler, matching what `follow` and `postNote` already do.

```ts
followers: protectedProcedure
  .input(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }))
  .query(({ ctx, input }) =>
    withRls(rlsContextOf(ctx.session), async (tx) => {
      const resolve = NOTE_TARGETS[input.entityType];
      if (!resolve)
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hỗ trợ ghi chú cho '${input.entityType}'` });
      const entity = await resolve(tx, input.entityId);
      if (!entity)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)' });
      return getFollowers(tx, input.entityType, input.entityId);
    }),
  ),
```

---

### MED — Unknown-program warn log spams on every cron tick per affected class

**Commit:** 13ddf5e
**File:** `apps/api/src/services/parent-meeting-cadence.ts:39-49`

**Root cause:**
The warn block fires when `!dates.length && !(program in PARENT_MEETING_CADENCE_MONTHS)`. There is no dedup — every cron tick for every class with an unknown program inserts a new `record_event` row. For a facility with N classes using unknown programs and cron running M times/day, this produces N×M audit rows.

**False-alarm analysis:** The guard `!(program in PARENT_MEETING_CADENCE_MONTHS)` correctly distinguishes unknown programs from known ones that happen to have 0 dates in the horizon. Known programs with empty horizons proceed to `continue` silently. The warn fires only for genuinely unknown programs. No false positives.

**Fix (two options):**
1. Minimal: add `timeframe` dedup — only log once per class per calendar day. E.g. check for existing `record_event` with same `entityId + body prefix` from today before inserting.
2. Better: log to application logger (not audit DB) so it does not pollute the chatter timeline. The audit timeline is a user-visible surface; operational warnings about config gaps belong in server logs.

If the class has no active users viewing the timeline, the pollution is invisible. Severity is MED (not a correctness defect, but scales badly).

---

### LOW — `reopen` / `setStatus(running)` does not restore soft-cancelled parent meetings

**Commit:** 1e9ddb7
**File:** `apps/api/src/routers/class-batch.ts:166-198`

**Root cause:**
When a class is reopened via `reopen` (or via `setStatus` with a non-terminal target), the soft-cancelled parent meetings remain `status: 'cancelled'`. The cadence generator only creates meetings for `status: 'running'` classes, but `skipDuplicates` and the unique `(classBatchId, scheduledAt)` constraint mean previously-cancelled rows will not be recreated — cancelled rows still occupy those date slots, so the cadence re-run produces nothing.

**Impact:** After reopening a class, its parent meetings are permanently orphaned as cancelled unless staff manually intervenes (no UI for that). If the class was closed in error, previously scheduled meetings are silently lost.

**Fix candidates:**
- Option A: In `reopen`, un-cancel meetings whose `scheduledAt >= now`.
- Option B: Accept the current behavior and document it. Staff must run `runCadence` and the unique constraint will block re-generation; the orphaned rows need a manual fix.
- Option C: Change the unique constraint to `(classBatchId, scheduledAt)` but make cancelled rows exempt from the constraint (partial unique index: `WHERE status != 'cancelled'`).

Option C is the correct long-term fix but requires a migration. This should be tracked as a follow-up, not a merge blocker.

---

## False Alarms (attack surface checked, not defective)

**Commit 1 (b39266e) — RLS gate for `audit.follow`:** The entity read at line 72-74 runs inside `withRls(rlsContextOf(ctx.session), ...)`. Each NOTE_TARGETS resolver (`receipt`, `opportunity`, `class_batch`) queries the respective table which has facility-scoped RLS. A staff member of facility B gets `null` back for any entity from facility A, triggering the 404. The `record_follower` write at line 75 is blocked correctly. SAFE.

**Commit 2 (1e9ddb7) — RLS scoping of `cancelFutureParentMeetings`:** The helper is called with `tx` that lives inside `withRls(rlsContextOf(ctx.session), ...)` in both `setStatus` and `cancel`. `parent_meeting` has facility-scoped RLS (`WITH CHECK`). A manager of facility B cannot cancel meetings belonging to facility A's class even if they supply a cross-facility `classBatchId`, because `parent_meeting.facility_id = ANY(app_facility_ids())` is enforced at the DB layer. SAFE.

**Commit 2 — off-by-one on `now` (today midnight UTC):** `new Date(new Date().toISOString().slice(0, 10))` produces `YYYY-MM-DDT00:00:00.000Z`. Auto-generated meetings use the same UTC-midnight representation. A meeting for today (midnight UTC) satisfies `gte: now`, so it is correctly cancelled when the class closes today. Past meetings (yesterday and earlier) are correctly preserved. SAFE.

**Commit 2 — idempotency on repeated `setStatus('closed')`:** `wasTerminal` is true for a class already closed; the cancel block is skipped on the second call. SAFE.

**Commit 3 (13ddf5e) — false warn for known programs with 0 horizon dates:** The guard `!(program in PARENT_MEETING_CADENCE_MONTHS)` runs inside the `!dates.length` branch. Known programs (UCREA / BRIGHT_IG / BLACK_HOLE) with dates outside the horizon return an empty array but the guard skips the warn because they are in the cadence map. SAFE — no false positives.

**Commit 4 (3bea963) — `setSchedule` cross-facility:** `findUniqueOrThrow` on `parent_meeting` inside `withRls(rlsContextOf(ctx.session), ...)` returns a Prisma P2025 not-found error if the row is hidden by RLS (staff B cannot see facility A's meeting). The subsequent `update` also has `WITH CHECK` on `facility_id`. Double-guarded. SAFE.

**Commit 4 — `setSchedule` P2002 unique conflict handling:** The catch block correctly maps `P2002` on `(classBatchId, scheduledAt)` to a CONFLICT response. Other errors are re-thrown. SAFE.

---

## Summary Table

| # | Commit | Severity | Status | Finding |
|---|--------|----------|--------|---------|
| 1 | 3bea963 | CRITICAL | NEEDS-FIX | Reminder fires for TBD meetings; sends midnight-time notification, permanently consumes the dedup slot |
| 2 | b39266e | HIGH | NEEDS-FIX | `audit.followers` endpoint lacks entity-visibility gate, leaks cross-facility userId list |
| 3 | 13ddf5e | MED | NEEDS-FIX (or accept + track) | Unknown-program warn writes unbounded audit rows per cron tick |
| 4 | 1e9ddb7 | LOW | ACCEPTABLE-WITH-TRACKING | Reopen does not restore cancelled meetings; cadence re-run blocked by orphaned rows |

---

## Verdict per commit

- **b39266e** (`audit.follow` gate): SAFE-TO-CLOSE for the `follow` mutation itself. Companion defect in `audit.followers` (pre-existing gap, now asymmetric) should be fixed alongside.
- **1e9ddb7** (soft-cancel on close): SAFE-TO-CLOSE. RLS scoping correct, boundary correct. Reopen gap is known/acceptable; track as follow-up.
- **13ddf5e** (unknown-program warn): SAFE-TO-CLOSE if warn volume is acceptable. Recommend switching to server logger before it ships to a facility with unknown programs.
- **3bea963** (time-TBD): NEEDS-FIX before merge. The reminder dedup bug causes a real user-facing defect (phantom notification + no real reminder ever fires for that meeting).

---

Status: DONE_WITH_CONCERNS
Summary: One CRITICAL defect in 3bea963 — the reminder service fires for time-TBD meetings at their midnight placeholder time, consuming the idempotency slot so the real confirmed-time reminder never fires. One HIGH gap in b39266e — `audit.followers` lacks the entity-visibility gate added to `audit.follow`. NEEDS-FIX on both before landing; commits 1e9ddb7 and 13ddf5e are clean.
