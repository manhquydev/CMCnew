---
phase: 2
title: "Code generation & display — implementation report"
status: completed
---

# Phase 2 Implementation Report

## Executed Phase
- Phase: phase-02-code-generation-display
- Plan: plans/260704-2130-employee-code-cmcx
- Status: completed

## Files Modified
- `apps/api/src/routers/payroll.ts` — added atomic code-assignment block in `upsertEmploymentProfile` after the profile upsert (+11 lines).
- `apps/api/src/routers/shift-registration.ts` — extended `list`'s existing `AppUser` batch-map with a second `EmploymentProfile` batch-map keyed by `userId`, merges `employeeCode` into `user` (+9 lines, no N+1).
- `apps/admin/src/shift-reg-list-panel.tsx` — "Nhân sự" cell now renders `CMC0001 · Họ tên` when `employeeCode` present, falls back to plain `Họ tên` (email still dimmed below in both cases) when null/missing (~3 lines changed).

## Tasks Completed
- [x] Atomic code-assignment block in `upsertEmploymentProfile`, guarded by `if (!profile.employeeCode)` — runs once, INSERT…ON CONFLICT…RETURNING pattern identical to `shift_code_counter` in `submit()`.
- [x] `shiftRegistration.list` batch-map extended with `employmentProfile.findMany({ where: { userId: { in: userIds } } })` — no relation include, matches loose-ref precedent.
- [x] List panel "Nhân sự" column prefixes employee code when available.

## Tests Status
- Type check: pass — `pnpm --filter @cmc/api exec tsc --noEmit` clean, `pnpm --filter @cmc/admin exec tsc --noEmit` clean.
- Unit tests: not run this phase (Phase 3 owns tests/verification per plan).
- Integration tests: not run this phase.

## Issues Encountered
- Initial destructuring `const [{ next }] = await tx.$queryRawUnsafe(...)` failed strict TS (`noUncheckedIndexedAccess`-style narrowing on array destructure default). Fixed by switching to `counter[0]?.next ?? 1`, matching the exact pattern already used in `shiftRegistration.submit()` for `shift_code_counter`. No spec deviation — same atomic-counter semantics, just TS-safe indexing.

## Verification of guard correctness
- Confirmed via read: `if (!profile.employeeCode) { ... }` wraps the entire counter-increment + update block. On re-upsert of a profile that already has a code, this block is skipped entirely — the counter is not incremented and `employeeCode` is left untouched. Only a profile with `employeeCode === null` (new profile, or one somehow missed by Phase 1 backfill) triggers assignment.

Status: DONE
Summary: Code-generation hook added to `upsertEmploymentProfile` (atomic, assign-once), `shiftRegistration.list` batch-map extended with `employeeCode`, and the admin list panel renders `CMC0001 · Họ tên`. Both `@cmc/api` and `@cmc/admin` typecheck clean.
Concerns/Blockers: none.
