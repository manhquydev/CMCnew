# Phase 3 — Navigation & routing

**Findings resolved:** #7
**~~#10~~ DROPPED — already fixed on `main`** (PR #26, `ec6d1c4`): `apps/lms/src/parent-shell.tsx:28`
now reads `{ tab: 'notifications', label: 'Thông báo', icon: <IconBell/> }` — verified live post
fast-forward. No mislabel remains.
**Effort:** 0.5h (was 1h, #10 removed) · **Lane:** normal

## Context links

- `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` (#7 "Nhân sự & Lương" always denies GĐKD — #10 resolved separately)
- Memory: `feedback-nav-naming-enterprise-not-personal` (nav wording rules)

## Current code shape (verified)

- **#7** `apps/admin/src/shell.tsx:461` — nav item `{ key: 'hr', label: 'Nhân sự & Lương', icon: <IconId/>, visible: visible('hr') }`. The `visible('hr')` gate lets the item render for GĐKD (giám đốc kinh doanh) but the target panel then denies access. Either the `visible('hr')` predicate is too permissive, or the guard on the HR panel is stricter than the nav.

## Implementation steps

### #7 — HR nav vs guard mismatch
1. Read the `visible('hr')` predicate in `shell.tsx` (the `visible()` helper + the permission it checks) and the HR/payroll panel's own permission gate (`payroll.profileList` etc., seen in `staff-profile.tsx:73`).
2. Align them: the nav item must use the **same** permission key the panel enforces (single source — reuse `can(me.roles, ..., 'payroll', 'profileList')` or whatever the panel gates on). If GĐKD is intentionally excluded from HR/Lương, `visible('hr')` returns false and the item disappears (preferred — no dead nav). If GĐKD *should* have partial access, fix the panel guard instead. Decide from the RBAC registry, not by guessing.
3. Do **not** loosen the panel's authorization to match the nav — hide the nav to match the guard (least privilege).

## Validation / tests

- [ ] #7: log in as GĐKD — "Nhân sự & Lương" either does not appear, or appears and opens without a FORBIDDEN/denied screen. No visible-but-dead nav item.
- [ ] #7: nav visibility predicate and panel guard reference the same permission (grep confirms one key, not two).
- [ ] `pnpm -w typecheck` clean.

## Risks & rollback

- **#7 is an authorization-adjacent display fix, not an authz change** — do not alter what the panel permits; only align nav visibility. If unsure whether GĐKD should see HR, leave the panel guard and hide the nav (safe default). Flag to user if business intent is ambiguous.
- Independent of other phases (disjoint file: `shell.tsx` admin).
