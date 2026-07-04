# Code Review — Plan A Cong ca workflow & UX fixes (pending diff)

## Scope
- apps/api/src/routers/shift-registration.ts
- packages/auth/src/permissions.ts
- apps/api/test/fixtures/permission-snapshot.json
- apps/admin/src/shift-reg-detail-panel.tsx
- apps/admin/src/shift-reg-list-panel.tsx
- `pnpm --filter @cmc/api exec tsc --noEmit` — clean
- `pnpm --filter @cmc/admin exec tsc --noEmit` — clean

## Verified correct (no bug found)

1. **Timezone**: `fromDate`/`toDate` are `@db.Date` (packages/db/prisma/schema.prisma:1644-1645) — date-only columns, Prisma returns UTC-midnight `Date` instances. `reg.fromDate.toISOString().slice(0,10)` in `submit`/`updateDates` is safe; no drift vs the `saigonToday()` lexicographic compare.
2. **updateDates check order** (shift-registration.ts:337-347): ownership (`reg.userId !== ctx.session.userId` → FORBIDDEN) is checked before the draft-status check, before range validation, before `assertFutureFrom`, before the mutation. Correct order; all inside one `withRls` transaction (already confirmed atomic by orchestrator).
3. **Entry deletion boundary** (shift-registration.ts:355-360): `OR:[{date:{lt:fromDate}},{date:{gt:toDate}}]` — entries dated exactly `fromDate`/`toDate` are NOT matched by either branch, so they're kept. Correct per spec ("thu hẹp range, entries ngoài range bị xoá").
4. **create-lock regression** (shift-registration.ts:209-218): guard is `status:{in:['draft','submitted']}`. A user whose prior ticket is `approved` or `cancelled` will not match this `findFirst` and can create a new one — no regression, matches acceptance criterion ("phiếu approved/cancelled không chặn").
5. **Checkbox single-mode fix** (shift-reg-detail-panel.tsx:322-329): uses `onChange` only (no `onClick` added) — avoids the double-toggle Mantine Checkbox pitfall the phase doc warned about. `toggle()` (lines 93-104) still produces a clean single-selection Set (`current.has(tmplId) ? new Set() : new Set([tmplId])`) — no dual-select possible.
6. **`me.userId` field usage** (shift-reg-list-panel.tsx:44-45): matches the existing convention in `apps/admin/src/attendance-roster.tsx:78` (`sessionInfo.teacherId !== me.userId`). Correct field name, not a divergence.
7. **hasOpen/showStaff data source**: `list.query({facilityId: fid})` is called with no `status` filter (shift-reg-list-panel.tsx:32), so `regs` is the full visible set — `hasOpen`/`showStaff` computed from it are not skewed by a hidden status-tab filter.
8. **List panel disables (not hides) the create button** with a tooltip explaining why — matches phase-03 spec exactly (`disabled` + `Tooltip label=... disabled={!hasOpen}`).
9. **`assertFutureFrom` client/server split**: client `minDate=tomorrow` is local-clock UX only; backend re-validates via `saigonToday()` at `create`, `updateDates`, and again at `submit` (shift-registration.ts:397) — so any TZ divergence between client and Asia/Saigon can only cause a harmless client-side false-accept/reject, never a server-side bypass. This is the exact fallback design phase-02's own risk section calls for.

## Important (non-blocking, flag for awareness)

**TOCTOU on status re-check in `updateDates` mutation vs. concurrent `submit`/`withdraw`.**
`updateDates` does `findUniqueOrThrow` (plain SELECT, no `FOR UPDATE`) to check `status === 'draft'`, then later calls `tx.shiftRegistration.update({where:{id}, data:{fromDate,toDate}})` — the `update`'s `where` clause does not re-assert `status: 'draft'`. Two concurrent requests (e.g., one tab calls `submit`, another calls `updateDates`, near-simultaneously) could each pass their own draft-status check against a stale read before either transaction commits, and the second-committing one's unconditional `update` would still apply — e.g., dates get silently rewritten on a ticket that has just become `submitted`.
- This is not new risk invented by this diff — `updateEntry` (shift-registration.ts:271-302) and `submit`/`withdraw` have the identical pattern (check-then-unconditional-update, no compound `where:{id,status:'draft'}` guard).
- Real-world likelihood is low (requires the same user racing two tabs/devices), and worst case is a data-consistency confusion, not privilege escalation or data loss (the audit log entry is still written with the actual old→new values).
- Recommendation if picked up later: add `status: 'draft'` into the `update`'s `where` clause (Prisma will throw `P2025` on 0-row match) instead of relying purely on the pre-read check — but this is a pattern-wide fix, not scoped to Plan A; flagging as informational rather than blocking this PR.

## Minor / Informational

- `DateInput` for `toDate` in the draft-edit header uses `minDate={tomorrow}` rather than `minDate={fromDate}` (shift-reg-detail-panel.tsx ~257-268), so a user can pick a `toDate` earlier than the current `fromDate` in the UI; the backend correctly rejects it (`BAD_REQUEST 'Khoảng ngày không hợp lệ'`) and the controlled `DateInput` reverts to the old value on the next render since it failed to update `reg`. Cosmetic UX gap only, not a spec deviation (phase-02 didn't require cross-field min binding) and not a bug.
- No dead code, no unjustified new abstractions, no lint-suppression patterns observed in the diff. Scope matches the four phase docs (A1-A4) with no scope creep.

## Plan/Spec Cross-check

All phase-01/02/03 acceptance criteria are satisfied by the diff as read:
- A1 lock: done (create-lock + list-panel disable).
- A2 date edit + future-date validation: done (updateDates mutation, saigonToday, assertFutureFrom applied at create/updateDates/submit, DateInput minDate on both detail-panel edit fields and NewRegForm).
- A3 deselect: done (Checkbox onChange only, no onClick).
- A4 staff column: done (list resolves `user` via batch map query, gated by `showStaff`).
- Permission registry + snapshot fixture: `updateDates` added consistently to both `packages/auth/src/permissions.ts` and `apps/api/test/fixtures/permission-snapshot.json` with identical role sets (`giao_vien`, `sale`, `cskh`).

Phase-04 (tests & verification) is out of scope for this diff — the 5 files reviewed here don't include new test files. Recommend confirming Phase 4 test coverage exists before merge (int tests for `updateDates` ownership/status/date-range/boundary-deletion cases weren't part of this diff).

## Unresolved Questions
- Is Phase 4 (tests) tracked as a separate pending change, or expected to land in this same PR? The reviewed diff has no test additions for the new `updateDates` mutation.
