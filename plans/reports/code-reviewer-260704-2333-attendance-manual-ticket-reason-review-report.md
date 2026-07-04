# Code Review — Plan A: Attendance Manual Ticket + Reason

Scope: apps/api/src/routers/check-in-out.ts, apps/api/src/routers/dashboard.ts, apps/admin/src/checkin-panel.tsx,
apps/admin/src/biz-director-cockpit-panel.tsx, apps/admin/src/edu-director-cockpit-panel.tsx,
packages/auth/src/permissions.ts, packages/db/prisma/schema.prisma + 2 migrations,
apps/api/test/work-shift-attendance.int.test.ts, apps/api/test/dashboard-my-approvals.int.test.ts,
apps/e2e/tests/work-shift-manual-punch-approval.spec.ts.

## CRITICAL

**`apps/api/test/fixtures/permission-snapshot.json` was not updated for the new `checkInOut.rejectManual`
permission entry — `permission-parity.test.ts` currently FAILS on `develop`.**

- `packages/auth/src/permissions.ts:333` adds `rejectManual: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao']`.
- `apps/api/test/fixtures/permission-snapshot.json` has no `checkInOut.rejectManual` key.
- Ran `npx vitest run test/permission-parity.test.ts` directly — confirmed failure:
  ```
  × registry has no entries absent from snapshot (no silent additions)
  Registry has entries not in snapshot:
  guardian.resetFamilyPassword
  checkInOut.rejectManual: expected [ Array(2) ] to have a length of +0 but got 2
  ```
- `guardian.resetFamilyPassword` is a pre-existing drift, unrelated to this diff (verified via
  `git diff HEAD~3 HEAD -- packages/auth/src/permissions.ts apps/api/test/fixtures/permission-snapshot.json`,
  which shows only `checkInOut.rejectManual` was added in the last commit touching permissions.ts).
  `checkInOut.rejectManual` is the new regression from this plan.
- This directly contradicts the task brief's claim that "all 34 relevant tests + full 591-test suite were
  run green before this review." Either the suite was run before `rejectManual` was added to
  `permissions.ts`, or the failing test was missed/ignored.
- Fix: add `"checkInOut.rejectManual": ["giam_doc_kinh_doanh", "giam_doc_dao_tao"]` to
  `apps/api/test/fixtures/permission-snapshot.json` (matches the registry entry already in place;
  no behavior change needed, this is a fixture-sync bug).

## HIGH

None found. Core mutation logic (`punch`, `approveManual`, `rejectManual`, `todayStatus`), RLS policy,
and authorization guards are correct — see verification notes below.

## MEDIUM

**No integration test exercises "reject an ALREADY-APPROVED ticket un-stamps its punches."**
`check-in-out.ts:372-382` (`if (wasApproved) { tx.timePunch.updateMany({..., approvedAt: null }) }`) is the
one genuinely new/tricky code path in this feature (reversing a payroll-relevant stamp), and it has zero
test coverage. The existing reject test (`work-shift-attendance.int.test.ts:270-294`) only rejects a
still-`pending` ticket, so `wasApproved` is always `false` there. Code review of the branch itself finds
no bug (correct facility/user/method/timestamp-range scoping, mirrors approveManual's `updateMany`), but
recommend adding a test: approve → reject → assert punches' `approvedAt`/`approvedById` are nulled again,
to lock in this specific regression class (this is exactly the kind of payroll-affecting behavior a future
refactor could silently break).

## LOW

1. **Stale comment referencing the old per-punch shape.**
   `apps/admin/src/biz-director-cockpit-panel.tsx:55` and `apps/admin/src/edu-director-cockpit-panel.tsx:56`:
   `// called inline with just {id} (or {punchId} for manualPunch). kpi is deliberately excluded:` — the
   actual call three lines below correctly uses `{ ticketId: item.id }` (line ~121-123), so the code is
   right, but the comment still says `punchId`, which will confuse the next reader into thinking the panel
   sends a raw punch id. Cosmetic; update comment to `ticketId`.

2. **`apps/e2e/tests/work-shift-manual-punch-approval.spec.ts`** variable name `punchId` (not `ticketId`) is
   fine as-is (it genuinely stores a punch id used to assert the punch-level stamp after ticket approval),
   not a bug — noted only because it surfaced in the `punchId` grep sweep, no action needed.

## Verification Notes (non-issues confirmed by reading, not assumed)

- **`punch` mutation early-return (`requiresReason`) correctly skips side effects.** The
  `requiresReason` returns happen *before* the punch row is created, before `pushFn` is computed, and
  before `logEvent` — all inside the `withRls(...)` callback. The `.then()` continuation
  (`check-in-out.ts:191-196`) checks `'requiresReason' in result` and returns early without touching
  `pushFn`/`punch`. No crash risk, no stale reference. Confirmed correct (H3 in review brief).
- **`approveManual`/`rejectManual` scoping.** Both use `ictDateRange(ticket.dateKey)` (start/end computed
  with the same `ICT_OFFSET_MS` as `ictDateKey`, `attendance-penalty.ts:58-62`) combined with
  `facilityId + userId + method:'manual'` — this exactly matches the window a punch would have been
  created in for that ticket's day. `rejectManual`'s un-stamp uses the identical `where` clause as
  `approveManual`'s stamp, so it reverses exactly (and only) what approve touched. Confirmed correct
  (item 1 in review brief).
- **Authorization.** `assertCanHandleTicket` (check-in-out.ts:43-54) blocks self-approve/self-reject
  unconditionally (checked before the `isSuperAdmin` bypass), then requires exact `managerId` match
  unless super_admin. `pendingManual`/`approveManual`/`rejectManual` are additionally gated to the two
  director roles only via the permission registry (`pendingManual`/`approveManual` unchanged from the
  pre-ticket design — confirmed via `git diff HEAD -- packages/auth/src/permissions.ts`, only
  `rejectManual` is new and uses the same role set). RLS on `manual_attendance_ticket`
  (`20260704155851.../migration.sql:24-28`) is byte-for-byte the same predicate as `time_punch`'s policy
  in `20260630140000_work_shift_rls/migration.sql:23-27`. Confirmed correct (item 2).
- **RLS migration.** Enabled, dropped-and-recreated policy, `USING`+`WITH CHECK` both present, matches
  `time_punch` pattern exactly. Confirmed correct.
- **Enum migration safety.** `20260704161036_manual_attendance_notif_events/migration.sql` adds two
  `StaffNotifEvent` values in one file. Stack runs `postgres:16-alpine` everywhere (docker-compose files,
  CI, `ci-integration-tests.sh`) — PG 16 allows `ALTER TYPE ... ADD VALUE` inside a transaction as long as
  the new value isn't used in the same transaction, which this migration doesn't do. Not a deploy risk on
  this stack. Confirmed non-issue (item 7).
- **`todayStatus.manualApproval` gating + UI badge branches.** Only computed when `punches.some(p =>
  p.method === 'manual')`, else `'none'`. The UI's four-way rendering (`checkin-panel.tsx:179-199`) is
  `rejected` → red, `pending` → yellow, else (covers both `none` and `approved`) → green "Hoàn thành" — all
  four `manualApproval` values are covered, no gap (item 5).
- **Reopen-on-reject is an UPDATE, not INSERT** (`check-in-out.ts:131-134`,
  `manualAttendanceTicket.update({ where: { id: existing.id }, ... })`) — cannot violate the
  `@@unique([userId, dateKey])` constraint since it targets the existing row by PK. Confirmed non-issue
  (item 6).
- **Blast radius / stale callers.** Grepped the whole repo for `approveManual`, `pendingManual`, `punchId`.
  Every live caller (`checkin-panel.tsx`, `biz-director-cockpit-panel.tsx`, `edu-director-cockpit-panel.tsx`,
  the e2e spec, both int-test files) uses the new `{ ticketId }` shape. Remaining `punchId` hits are the
  stale comments noted under LOW and the e2e fixture's own punch-id variable (correct usage, not a stale
  API-shape reference). No missed touchpoint found (item 4).
- **Emit-notif null safety.** `emitStaffNotif` always returns a callable push function (no-op when
  `recipientIds` is empty), so `rejectManual`'s unconditional `pushFn()` call
  (`check-in-out.ts:399-402`) cannot throw even if the ticket's user has no manager/recipients configured.

## Not Verified / Out of Scope

- **Concurrent punch vs. concurrent approve race**: if a punch is created in the same instant a manager's
  `approveManual` runs (punch reads ticket as still-pending right before approve commits;
  `approveManual`'s `updateMany` on the time-range then finishes before the new punch row exists), the new
  punch will not inherit the just-granted approval and will sit unstamped until the next explicit
  action touches it. This is a narrow, low-probability window and is not a regression introduced by this
  plan (the same class of race existed under the old per-punch approve flow); flagging for awareness only,
  not blocking.
- E2E spec not executed this session (no running dev/browser stack), per task instructions — reviewed
  statically only; found no bugs in the fixture or assertions.

## Recommended Actions (priority order)

1. **CRITICAL**: Add `"checkInOut.rejectManual": ["giam_doc_kinh_doanh", "giam_doc_dao_tao"]` to
   `apps/api/test/fixtures/permission-snapshot.json` and re-run `permission-parity.test.ts` to confirm green.
2. **MEDIUM**: Add an integration test asserting reject-after-approve un-stamps punches
   (`work-shift-attendance.int.test.ts`).
3. **LOW**: Fix the stale `punchId` wording in the two cockpit-panel comments.

## Plan TODO Follow-up

Plan `plans/260704-2133-attendance-manual-ticket-reason/` phases 01-04 (schema+RLS, punch/todayStatus,
per-ticket approve/reject, UI dialog) all appear functionally implemented and match
`docs/decisions/0034-manual-attendance-daily-ticket.md`. The only blocking gap before this is safe to
merge/ship is the permission-snapshot fixture fix above — that is a CI-blocking test failure, not a design
issue, and should be a fast fix. Leave plan status updates to the lead/planner.

Status: DONE_WITH_CONCERNS
