# Phase 3: Frontend list panel — Implementation Report

## Status
DONE

## Files Modified
- `apps/admin/src/shift-reg-list-panel.tsx` (~30 lines added/changed)

## Changes
- A1: added `hasOpen = regs.some(r => r.userId === me.userId && ['draft','submitted'].includes(r.status))`. "Tạo phiếu" Button wrapped in Mantine `Tooltip` (disabled when `!hasOpen`), Button gets `disabled={hasOpen}` — matches existing repo pattern in `email-outbox-panel.tsx:211-226`. `canCreate` gate unchanged (AND condition preserved via existing `{canCreate && (...)}` wrap).
- A4: added `showStaff = regs.some(r => r.userId !== me.userId)`. Conditionally rendered `<Table.Th>Nhân sự</Table.Th>` (only when `showStaff`) between "Mã phiếu" and "Từ ngày", and matching `<Table.Td>` cell showing `r.user.displayName` (bold) + `r.user.email` (dimmed xs), fallback `—` when `r.user` is null.
- No new API calls — reused existing `regs` state from `load()`.

## Key finding
Session id field is `me.userId`, not `me.id` — confirmed via `apps/api/src/routers/auth.ts` (`publicUser` returns `userId`) and `packages/ui/src/login-gate.tsx` (`Session = NonNullable<Awaited<ReturnType<typeof trpc.auth.me.query>>>`). Backend router (`shift-registration.ts`) also uses `ctx.session.userId` throughout, matching Phase 1's `visibleRegistrationWhere`/list `user` attachment logic.

## Tests Status
- Type check: PASS (`npx tsc --noEmit -p apps/admin`, no errors)
- Unit/integration tests: not run (no existing test file for this panel; phase file did not request new tests)

## Verification
- Diff limited to the one owned file.
- `ShiftReg` type is inferred via tRPC (`Awaited<ReturnType<typeof trpc.shiftRegistration.list.query>>[number]`), so the `user` field added in Phase 1 flows through automatically — no manual type edits needed.

Status: DONE
Summary: Implemented A1 (disable+tooltip on "Tạo phiếu" when user has an open draft/submitted ticket) and A4 (conditional "Nhân sự" column showing displayName+email) in shift-reg-list-panel.tsx; typecheck passes.
Concerns/Blockers: none — `me.id` assumption in phase file was wrong, actual field is `me.userId`, corrected during implementation.
