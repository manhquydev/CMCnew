# Phase 2 — HR onboarding: full record API + UI + sensitive masking

## Context links
- Brainstorm §2 Mạch người, D4; plan.md file-ownership (extends seam-fixes P5 forms).
- Anchors: `apps/api/src/routers/user.ts:83-92` (create input, no phone), `:116-121` (facility guard on non-superadmin branch only); `apps/api/src/routers/payroll.ts:327-379` (profileUpsert); `apps/admin/src/staff-profile.tsx`; `apps/admin/src/App.tsx:267` (UserCreateModal).
- Schema: AppUser email @unique + phone exist; EmploymentProfile columns from P1.

## Overview
Make new-staff onboarding a single complete record: capture phone at user.create, extend profileUpsert with managerId/startedAt/new columns, surface all in the onboarding form, mask CCCD/bank on read for non-privileged roles, friendly duplicate-email error, and fix the facility-less-account guard.

## Key Insights
- **HARD ENTRY GATE (M4) — verify before starting.** Plan-1 (seam-fixes) P5 is marked "implemented" but grep of the working tree finds ZERO admin-UI callers of `payroll.profileUpsert`/`rateCreate` (`staff-profile.tsx` calls profileList/rateList/listByStaff/staffTimeline only). The form scaffold this phase "extends" may NOT exist. At P2 START: re-grep `apps/admin/src` for `profileUpsert`/`rateCreate` callers. If still zero, this phase FOLDS IN Plan-1's incomplete work and BUILDS the base profileUpsert/rateCreate form itself (add to effort). Do not assume it exists.
- `managerId` is the linchpin: profileUpsert input currently lacks it (`payroll.ts:328-339`), so shift-approval always falls back to director role-resolve (`shift-registration.ts:17-58`). Adding managerId input here is what makes P4's delegated-approver flow reachable.
- **M8 — managerId has ZERO validation planned.** Loose no-FK column (`schema.prisma:1334-1337`); `resolveManager` routes to whatever is there. Required guards in profileUpsert: (a) `managerId ≠ userId` (self-reference → self-block at `shift-registration.ts:91` makes packets approvable only by nextManagerId/super_admin); (b) target is ACTIVE co-facility staff (cross-facility/inactive/nonexistent UUID rejected); (c) cycle detection A↔B mutual manager (approval-authority loop / collusion) — `resolveManager` only walks 2 levels so no infinite loop, but reject the mutual pair explicitly. Document the A↔B stance in the phase.
- N2: `profileUpsert` ALREADY accepts `startedAt` (`payroll.ts:335,360,369`) — Plan-1 landed it. Only `managerId` + the 4 sensitive columns are NEW here. (`assertCanManagePayrollTarget` self-block :37 + domain scoping :40-44 already cover the new fields — TRUE assumption.)
- Facility guard (`user.ts:116-121`) sits only on the non-superadmin branch → super_admin can mint a 0-facility account. Add a min(1) facility check that also covers super_admin (a login with no facility has no RLS scope → dead account).
- Duplicate email → raw Prisma P2002. Catch → friendly TRPCError CONFLICT.

## Requirements
- `user.create` input += `phone` (optional; AppUser.phone exists), persisted at create.
- `payroll.profileUpsert` input += `managerId`, `address`, `nationalId`, `bankAccount`, `bankName` (startedAt already accepted — N2). managerId validated: ≠ self, active co-facility target, reject A↔B mutual pair (M8).
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
3. `profileUpsert`: extend input Zod with managerId (uuid optional) + 4 new strings (startedAt already present); validate managerId (≠ self, active co-facility, no A↔B cycle — M8); on write, diff sensitive fields → logEvent audit (field changed, actorId).
4. Profile read resolver: apply `maskSensitive` to nationalId/bankAccount when `!canReadSensitiveHr`.
5. Extend onboarding form + UserCreateModal with fields; sensitive inputs disabled + masked display for non-privileged.
6. Int test: onboarding creates login-able user w/ profile+rate; managerId set; masking matrix.

## Todo list
- [ ] HARD GATE: re-grep profileUpsert/rateCreate UI callers; build base form if absent (M4)
- [ ] user.create phone + dup-email friendly + facility guard (super_admin)
- [ ] profileUpsert input extend (managerId + 4 cols) + managerId validation (self/facility/cycle — M8)
- [ ] server-side mask on read + audit on sensitive change
- [ ] onboarding form / UserCreateModal fields
- [ ] int test: full onboarding + masking matrix + managerId reject (self/cross-facility/A↔B)

## Success Criteria
- New staff created in one form logs in via SSO, has profile + rate, managerId set.
- Non-privileged role sees masked CCCD/bank; 2 directors + super_admin see/edit full; each edit audited.
- Duplicate email → friendly message; 0-facility create rejected for all roles.

## Risk Assessment
- Missing dependency (M4) — was MAJOR. Hard gate re-verifies P5 form callers; fold-in build if absent.
- managerId invalid (self/cross-facility/cycle — M8) — was MAJOR. Explicit validation in profileUpsert + reject tests.
- Masking bypass via other read paths — Med×High. Enumerate ALL procedures returning EmploymentProfile (grep) and gate each; add int test asserting mask on the list endpoint too. N1: today the ONLY client read is `profileList` (`payroll.ts:381-387`, roles = the 2 directors = exactly `canReadSensitiveHr`), so no non-privileged reader exists yet — masking is defense-in-depth. `profileList`'s unselected `findMany` WILL return the raw new columns by default; that call site MUST get an explicit select/mask even before an HR/self-view surface is added.
- profileUpsert self-write of own sensitive record — Low×Med. Seam-fixes P5 already blocks director self-target on profileUpsert (Decision B); confirm that guard covers new fields.

## Security Considerations
- Never log raw CCCD/bank; audit records field name + actor only.
- Mask server-side; client never receives full value for non-privileged.

## Rollback
- API: input additions are backward-compatible (optional). Revert = drop new input fields + masking; no data migration.

## Next steps
- P4 relies on managerId being settable (delegated approver).
