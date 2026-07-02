# Phase 2 — HR onboarding: full record API + UI + sensitive masking

## Context links
- Brainstorm §2 Mạch người, D4; plan.md file-ownership (extends seam-fixes P5 forms).
- Anchors: `apps/api/src/routers/user.ts:83-92` (create input, no phone), `:116-121` (facility guard on non-superadmin branch only); `apps/api/src/routers/payroll.ts:327-379` (profileUpsert); `apps/admin/src/staff-profile.tsx`; `apps/admin/src/App.tsx:267` (UserCreateModal).
- Schema: AppUser email @unique + phone exist; EmploymentProfile columns from P1.

## Overview
Make new-staff onboarding a single complete record: capture phone at user.create, extend profileUpsert with managerId/startedAt/new columns, surface all in the onboarding form, mask CCCD/bank on read for non-privileged roles, friendly duplicate-email error, and fix the facility-less-account guard.

## Key Insights
- **DEPENDS on seam-fixes P5** which wires the profileUpsert/rateCreate forms. Plan 3 EXTENDS those forms with new fields — do NOT rebuild the form scaffold. Re-read staff-profile.tsx at execution to confirm P5's shape landed.
- `managerId` is the linchpin: profileUpsert input currently lacks it (`payroll.ts:328-339`), so shift-approval always falls back to director role-resolve (`shift-registration.ts:17-58`). Adding managerId input here is what makes P4's delegated-approver flow reachable.
- Facility guard (`user.ts:116-121`) sits only on the non-superadmin branch → super_admin can mint a 0-facility account. Add a min(1) facility check that also covers super_admin (a login with no facility has no RLS scope → dead account).
- Duplicate email → raw Prisma P2002. Catch → friendly TRPCError CONFLICT.

## Requirements
- `user.create` input += `phone` (optional; AppUser.phone exists), persisted at create.
- `payroll.profileUpsert` input += `managerId`, `startedAt`, `address`, `nationalId`, `bankAccount`, `bankName`.
- On profile READ: CCCD/bank returned masked unless `canReadSensitiveHr(session)` (P1 helper); privileged edit allowed; every sensitive-field change writes an audit event (field name only, never raw value).
- Onboarding form (single modal) collects all fields; sensitive fields render masked + edit-gated.
- Friendly duplicate-email error; facility min(1) guard covering super_admin.

## Architecture
- Data in: onboarding form → user.create (email/name/roles/facility/phone) → then profileUpsert (position/grade/managerId/startedAt/sensitive) + rateCreate (seam-fixes P5).
- Data out: AppUser row + EmploymentProfile row + SalaryRate row; SSO login enabled; shift packets now route via managerId.
- Masking boundary: server-side in profileUpsert/profile-read resolver — mask BEFORE data leaves API; never rely on client to hide.

## Related code files
- `apps/api/src/routers/user.ts:83-92,116-121` (modify: phone input, dup-email catch, facility guard).
- `apps/api/src/routers/payroll.ts:327-379` (modify: profileUpsert input + read masking + audit).
- `apps/admin/src/staff-profile.tsx` (modify: extend P5 form).
- `apps/admin/src/App.tsx:267` UserCreateModal (modify: onboarding fields).

## Implementation Steps
1. `user.create`: add `phone: z.string().optional()`; write to AppUser; wrap create in try/catch P2002 → CONFLICT "Email đã tồn tại".
2. Move/duplicate facility min(1) guard so super_admin path also enforced.
3. `profileUpsert`: extend input Zod with managerId (uuid optional), startedAt (date optional), 4 new strings; on write, diff sensitive fields → logEvent audit (field changed, actorId).
4. Profile read resolver: apply `maskSensitive` to nationalId/bankAccount when `!canReadSensitiveHr`.
5. Extend onboarding form + UserCreateModal with fields; sensitive inputs disabled + masked display for non-privileged.
6. Int test: onboarding creates login-able user w/ profile+rate; managerId set; masking matrix.

## Todo list
- [ ] user.create phone + dup-email friendly + facility guard (super_admin)
- [ ] profileUpsert input extend (managerId/startedAt/4 cols)
- [ ] server-side mask on read + audit on sensitive change
- [ ] onboarding form / UserCreateModal fields (extend seam-fixes P5)
- [ ] int test: full onboarding + masking matrix

## Success Criteria
- New staff created in one form logs in via SSO, has profile + rate, managerId set.
- Non-privileged role sees masked CCCD/bank; 2 directors + super_admin see/edit full; each edit audited.
- Duplicate email → friendly message; 0-facility create rejected for all roles.

## Risk Assessment
- Masking bypass via other read paths — Med×High. Enumerate ALL procedures returning EmploymentProfile (grep) and gate each; add int test asserting mask on the list endpoint too.
- profileUpsert self-write of own sensitive record — Low×Med. Seam-fixes P5 already blocks director self-target on profileUpsert (Decision B); confirm that guard covers new fields.

## Security Considerations
- Never log raw CCCD/bank; audit records field name + actor only.
- Mask server-side; client never receives full value for non-privileged.

## Rollback
- API: input additions are backward-compatible (optional). Revert = drop new input fields + masking; no data migration.

## Next steps
- P4 relies on managerId being settable (delegated approver).
