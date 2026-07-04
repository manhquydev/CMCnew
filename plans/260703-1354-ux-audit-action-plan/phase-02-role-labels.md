# Phase 2 — Auth/Users & Roles: Vietnamese role labels

**Status: DROPPED — already resolved on `main`.**

Finding #5 ("raw backend role enums shown instead of labels") is fully fixed by PR #26 (commit
`ec6d1c4`), which pre-dates this plan's branch rebase. Verified directly against current code
(post fast-forward to `main` tip `84ff0d2`):

- `packages/auth/src/permissions.ts:15-25` — `ROLE_LABEL: Record<string, string>` with all 9
  entries, exhaustive against `enum Role` in `packages/db/prisma/schema.prisma:17-27` (1:1 match,
  verified by diff — no missing/extra keys).
- `apps/admin/src/App.tsx:14,385,417,449` — `ROLE_LABEL` imported and used for the Users/Roles
  table (`u.roles.map((r) => ROLE_LABEL[r] ?? r)`) and role-select dropdowns.
- `apps/admin/src/staff-profile.tsx:11,457` — `ROLE_LABEL` used for role badges.

No raw enum leak remains anywhere role labels render in the admin UI. This phase file is kept only
as a record of why #5 was scoped out — do not re-open unless a fresh regression is confirmed with
file:line evidence (this note is not a substitute for re-verifying if the codebase moves on).

**Original scope (superseded, kept for history):** this plan originally proposed a new
`packages/auth/src/role-labels.ts` helper — dropped in favor of the existing `ROLE_LABEL`, per
user decision (2026-07-03), to avoid a second competing source of truth for the same concept.
