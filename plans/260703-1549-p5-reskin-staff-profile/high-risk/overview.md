# Overview

## Current Behavior

`apps/admin/src/staff-profile.tsx` is a hand-rolled staff record page: 2 Fieldsets (Định danh,
Phân quyền) + Tabs (EmploymentTab, PayrollTab gated by `canPayroll`) + right-rail ActivityLog,
with a header-level Save button running a local `save()` closure that gates on `roleEditInvalid`
(`rolesChanged && (roles.length===0 || !primaryRole)`) and an empty-`displayName` check, and
auto-clears `primaryRole` when it's removed from the selected `roles` set. Edits change role,
facility assignment, and active status for real staff accounts — session-invalidating changes.

## Target Behavior

Same page, same behavior, re-implemented on top of `packages/ui/src/record-detail.tsx` (P2's
generic primitive) so the sheet+tabs+activity-log shape is reusable for other entities. Zero
user-visible behavior change is the acceptance bar — this is a re-implementation, not a redesign.

## Affected Users

- HR/Admin staff editing employee records (role, facility, active status, payroll visibility).
- Any staff member viewing their own profile (read path).

## Affected Product Docs

- None found under `docs/product/` referencing staff-profile specifically.

## Non-Goals

- No visual/design change (P1's Zero Elevation tokens apply automatically via the primitive, no
  separate redesign work here).
- No new fields or new business rules — pure re-implementation.
- Not extending `record-detail.tsx` beyond what this migration requires (no speculative generality).
