# Phase U2 — Org Edit Parity

## Context Links

- Plan: `plan.md`; depends on U1 shell.
- `apps/api/src/routers/facility.ts` — `update` exists (~L19, `superAdminProcedure`), no UI.
- `apps/api/src/routers/user.ts` — has setRoles/setActive/setFacilities (super-admin); NO displayName/phone/email update.
- `apps/admin/src/App.tsx` — `Facilities()` (~L220-276) list+create only; `UserEditModal` (~L369-461).
- Audit: `logEvent` pattern already used by user/facility mutations.

## Overview

Close the editing gaps the brainstorm found: facilities cannot be edited in UI, and basic staff contact fields cannot be edited at all. Add narrow, audited write paths — no scope creep.

## Requirements

### Facility edit
- Wire existing `facility.update` to a UI edit form (detail drawer or modal) on the facility row.
- Editable: name, code, address, isActive (timezone optional — confirm). `id` immutable.
- Keep `superAdminProcedure` gate (no change to authz contract).
- Audit already emitted by `facility.update` — verify it records changed fields.

### User contact edit
- Add `user.updateProfile` mutation: `displayName`, `phone` ONLY.
  - `email` is SSO-derived → READ-ONLY, not accepted by the endpoint.
  - Gate: super_admin (confirm whether directors may edit within facility — OPEN QUESTION in plan.md).
  - Must `logEvent` with field-level changes, mirroring `user.setRoles` audit.
  - Do NOT bump `tokenVersion` (contact change is not a security-session change) — confirm.
- Wire into the Staff Profile "Hồ sơ" tab edit action (or UserEditModal extension).

## Files To Modify/Create (proposed)

- Modify `apps/api/src/routers/user.ts` — add `updateProfile` mutation + Zod input (displayName, phone).
- Modify `packages/auth/src/permissions.ts` — register `user.updateProfile` gate (reuse an existing key only if it matches; else add).
- Modify `apps/admin/src/App.tsx` (or `staff-profile.tsx`) — facility edit UI + user contact edit form.
- Migration: only if `phone` storage/validation needs change (AppUser already has `phone?` per schema — verify before adding).

## Validation

- Unit: `updateProfile` rejects `email`; accepts displayName/phone; writes audit; respects gate.
- Integration: non-permitted role gets FORBIDDEN; permitted role updates + audit row present.
- Integration: facility.update via UI changes fields + audit; isActive toggle respected.
- Regression: setRoles/setActive/setFacilities unchanged; login/session unaffected by contact edit.

## Risks and Rollback

Risk: over-broad edit (someone edits email/roles via the new path).
Mitigation: endpoint accepts ONLY displayName/phone; authz gate; audit.
Risk: directors editing across facility.
Mitigation: resolve OPEN QUESTION before enabling director access; default super_admin-only.
Rollback: remove the new endpoint + UI; facility/user edit revert to prior state (create-only / role-modal).
