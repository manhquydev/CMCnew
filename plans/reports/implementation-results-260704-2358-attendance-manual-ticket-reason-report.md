# Implementation Results — Plan A: attendance-manual-ticket-reason

- Plan: `plans/260704-2133-attendance-manual-ticket-reason/` (status: completed)
- Decision: `docs/decisions/0034-manual-attendance-daily-ticket.md`
- Branch: develop

## What shipped

1. **Schema+RLS**: `ManualAttendanceTicket` model, `@@unique([userId,dateKey])`, RLS policy matching `time_punch`. Migrations `20260704155851_manual_attendance_ticket` + `20260704161036_manual_attendance_notif_events` (2 new `StaffNotifEvent` enum values). Applied to dev DB, `prisma generate` refreshed.
2. **`punch()` rewrite**: branches on ticket status (none/pending/approved/rejected). No-ticket+no-reason → `requiresReason`. Rejected ticket + new reason → reopens to pending (resubmit). Approved ticket → new punch auto-inherits `approvedAt`. Fixed a real return-shape bug (H2, found in red-team) where the post-commit `.then` would have swallowed the `requiresReason` flag.
3. **Duyệt/reject per-ticket**: `approveManual({ticketId})` stamps `approvedAt` on the ticket AND every manual punch that ICT day (facility-scoped `where`); `rejectManual` un-stamps if previously approved. Self-approve/reject guard (`assertCanHandleTicket`). `pendingManual` batches punch-count/shift lookup in O(1) queries (no N+1).
4. **`todayStatus.manualApproval`**: exposes none/pending/approved/rejected so a rejected day never renders green "Hoàn thành" in the UI.
5. **UI**: reason modal (+resubmit variant) in `checkin-panel.tsx`; pending-manual table now shows reason/punch-count/shift with Duyệt+Từ chối buttons; 3-way badge (Hoàn thành/Chờ duyệt/Bị từ chối).
6. **Blast-radius fixes beyond the plan's original file list** (found by grep + code-review, not anticipated at planning time):
   - `apps/api/src/routers/dashboard.ts` — `manualPunchPendingItems` (feeds the exec "myApprovals" inbox) switched from per-punch to per-ticket.
   - `apps/admin/src/biz-director-cockpit-panel.tsx`, `edu-director-cockpit-panel.tsx` — `approveManual` calls updated `{punchId}` → `{ticketId}`.
   - `apps/e2e/tests/work-shift-manual-punch-approval.spec.ts` — fixture now seeds a ticket, row selector matches on reason text instead of IP.

## Verification

- `pnpm --filter @cmc/api typecheck` / `@cmc/admin typecheck` / `@cmc/db typecheck`: clean.
- `pnpm --filter @cmc/api lint` / `@cmc/admin lint`: clean (pre-existing unrelated warnings only).
- Integration suite (`apps/api`, real Postgres): **591/591 passed**, including 3 new schema/RLS tests, 4 new/rewritten punch+ticket scenarios, 1 rejected-ticket-resubmit scenario, updated dashboard-approvals tests.
- Unit suite: 2 pre-existing, unrelated failures confirmed via `git stash` (fail identically with my changes stashed): `test/brevo-client.test.ts` (stale env API key) and `permission-parity.test.ts`'s `guardian.resetFamilyPassword` snapshot gap (predates this session). Not touched — outside this plan's scope.
- `code-reviewer` subagent pass: found 1 CRITICAL (real) — `checkInOut.rejectManual` missing from `apps/api/test/fixtures/permission-snapshot.json`, causing `permission-parity.test.ts` to fail — fixed. 1 MEDIUM (missing test: reject an already-approved ticket un-stamps punches) — added. 1 LOW (stale `{punchId}` comment wording in 2 cockpit files) — fixed. Re-verified all green after fixes.
- E2E `work-shift-manual-punch-approval.spec.ts` was updated for the new fixture/selector but **not executed this session** (no running dev/browser stack; the api dev server was stopped earlier to release a Prisma engine file lock and never restarted). Flag for manual verification before merge.

## Unresolved / follow-ups

- E2E spec not run — recommend running `pnpm --filter @cmc/e2e test work-shift-manual-punch-approval` once dev stack is up before merging.
- Resubmit-after-reject has no attempt cap (explicit YAGNI per plan; audited via `logEvent` + notify). Revisit if abuse observed.
- Night-shift crossing ICT midnight remains out of scope (per user decision).
- 2 pre-existing unrelated test failures (brevo-client, guardian.resetFamilyPassword snapshot) left untouched — not part of this plan's authorized scope.
