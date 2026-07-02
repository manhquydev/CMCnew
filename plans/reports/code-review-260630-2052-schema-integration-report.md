# Code Review: Work Shift System -- Schema & Integration

**Date**: 2026-06-30 | **Reviewer**: code-reviewer agent
**Scope**: Prisma schema (Phase 6 models), permissions registry, router registration, nav integration, UI wiring

---

## Issues Found

### CRITICAL

#### C1. Permission snapshot missing all shift/checkin entries

**File**: `apps/api/test/fixtures/permission-snapshot.json`
**Severity**: CRITICAL -- CI will fail on permission parity test

The snapshot has ZERO entries for the four new modules. The "no silent additions" test (permission-parity.test.ts line 38-48) will fail because PERMISSIONS registry has entries absent from snapshot.

**Missing entries (21 total)**:
- `shiftConfig.list`, `.create`, `.update`, `.archive` (4 entries)
- `shiftReg.list`, `.get`, `.create`, `.updateEntry`, `.submit`, `.withdraw`, `.approve`, `.reject`, `.registeredInMonth` (9 entries)
- `checkInOut.checkIn`, `.checkOut`, `.todayStatus`, `.history`, `.monthlyReport`, `.approveManual` (6 entries)
- `facilityNetwork.list`, `.create`, `.delete` (3 entries)

**Fix**: Add all 21 entries to `permission-snapshot.json`, with role lists matching `packages/auth/src/permissions.ts` exactly, sorted alphabetically per role list. Run `npx vitest apps/api/test/permission-parity.test.ts` after.

---

#### C2. Orphaned permission entries: procedures that don't exist

**File**: `packages/auth/src/permissions.ts`
**Severity**: CRITICAL -- tRPC client calls will 404; permissions carry dead weight

Four permission entries have NO matching procedure in the router:

| Permission entry | File:Line | Router file | Missing procedure |
|---|---|---|---|
| `checkInOut.checkOut` | permissions.ts:263 | `check-in-out.ts` | No `checkOut` proc (check-in/out unified in `punch`) |
| `checkInOut.monthlyReport` | permissions.ts:267 | `check-in-out.ts` | No `monthlyReport` proc exists |
| `shiftConfig.update` | permissions.ts:243 | `shift-config.ts` | No `update` proc exists |
| `shiftConfig.archive` | permissions.ts:244 | `shift-config.ts` | No `archive` proc exists |

**Fix**: Either (a) add the missing procedures to their routers, or (b) remove the orphaned entries from PERMISSIONS. The UI panel calls `trpc.checkInOut.punch` (not `checkIn`/`checkOut`), so option (b) for `checkOut` is correct -- `checkIn` already gates the unified punch. `monthlyReport` should be added to check-in-out.ts if the feature is planned; otherwise removed.

---

#### C3. Missing permission entry: shiftConfig.createTemplate

**File**: `packages/auth/src/permissions.ts` line 239-245 (module block)
**File**: `apps/api/src/routers/shift-config.ts` line 59
**Severity**: CRITICAL -- audit gap; inconsistent with codebase pattern

`shiftConfig.createTemplate` is a `superAdminProcedure` that exists in the router (line 59) but has NO entry in PERMISSIONS. The codebase convention (documented at permissions.ts line 71-76 for `compensation.*`) is that super-admin-only procedures ARE listed in the registry for a complete audit map. `shiftConfig.create` follows this convention; `createTemplate` breaks it.

**Fix**: Add `createTemplate: ['super_admin']` to the `shiftConfig` block in PERMISSIONS, and add `shiftConfig.createTemplate` to the snapshot.

---

#### C4. Router key / permission module name mismatch: `shiftRegistration` vs `shiftReg`

**File**: `apps/api/src/routers/index.ts` line 72
**File**: `packages/auth/src/permissions.ts` line 247 (module key)
**File**: `apps/api/src/routers/shift-registration.ts` lines 60-330

The tRPC router is registered as `shiftRegistration: shiftRegistrationRouter` but all `requirePermission()` calls inside use `'shiftReg'` as the module name. The PERMISSIONS registry key is `shiftReg`.

Client calls: `trpc.shiftRegistration.list.query()` -- matches router key.
Permission check: `PERMISSIONS['shiftReg']` -- matches permissions key.

These two keys are different. A future developer adding a procedure and following the router key would write `requirePermission('shiftRegistration', ...)` and hit a runtime FORBIDDEN because `PERMISSIONS['shiftRegistration']` is undefined.

**Fix**: Rename the PERMISSIONS key from `shiftReg` to `shiftRegistration` (and update all 9 `requirePermission` calls + snapshot entries), OR rename the router key. Prefer matching the router key since that's what the client sees. Also update `NAV_GATES` if the key used there changes.

---

### HIGH

#### H1. EmploymentProfile.managerId: self-referential FK without relation

**File**: `prisma/schema.prisma` line 1259
**Severity**: HIGH -- no referential integrity; dangling manager references possible

`managerId` is declared as a plain `String? @db.Uuid` with `@@index([managerId])` but NO `@relation` to `AppUser`. Prisma will NOT generate a foreign key constraint. A managerId can point to a deleted or non-existent user.

Same pattern applies to `ShiftRegistration.managerId` (line 1481) and `ShiftRegistration.nextManagerId` (line 1482) -- both are plain UUID fields with no relation.

The model comment at line 1247 says "khong khai bao quan he de giu AppUser gon" for `userId`, but this justification is weaker for `managerId` which is a self-referential FK. Without a constraint, `resolveManager()` (shift-registration.ts line 18-55) can resolve a stale managerId and assign it to a new registration.

**Fix**: Either add explicit `@relation` fields with `onDelete: SetNull` (since you wouldn't want to cascade-delete EmploymentProfile records when a manager is deleted), or add application-level validation in `resolveManager()` that verifies the resolved managerId is a valid active user.

---

#### H2. File naming inconsistency: facility-ip.ts vs FacilityNetwork

**File**: `apps/api/src/routers/facility-ip.ts`
**Severity**: HIGH -- discoverability hazard; breaks kebab-case naming conventions

The router file is named `facility-ip.ts` but:
- The Prisma model is `FacilityNetwork`
- The permission module is `facilityNetwork`
- The router variable is `facilityNetworkRouter`
- The procedure logEvent calls use `entityType: 'facility_network'`

The filename `facility-ip` is a ghost of an earlier concept. Every other router in the directory follows the pattern `<domain-concept>.ts` (e.g., `shift-config.ts`, `check-in-out.ts`). Developers looking for the facility network router will not find it by filename.

**Fix**: Rename `facility-ip.ts` to `facility-network.ts` and update the import in `routers/index.ts`.

---

#### H3. ShiftTemplate @@unique([facilityId, code]) prevents same code across groups

**File**: `prisma/schema.prisma` line 1460
**Severity**: HIGH -- schema design prevents valid business configuration

The unique constraint on `(facilityId, code)` means within a facility, the code "CA_SANG" can only exist once TOTAL, across ALL shift groups. But two groups like "KINH_DOANH" and "GIAO_VIEN" may both need a "CA_SANG" template with different hours (e.g., 8h for KD, 4h for GV).

The constraint on line 1461 (`@@unique([shiftGroupId, startTime])`) already provides natural uniqueness within a group. The `(facilityId, code)` constraint should probably be `(shiftGroupId, code)` instead.

**Fix**: Change `@@unique([facilityId, code])` to `@@unique([shiftGroupId, code])` on line 1460. A migration is needed.

---

#### H4. Check-in history lacks cross-facility access control

**File**: `apps/api/src/routers/check-in-out.ts` lines 195-211
**Severity**: HIGH -- staff from one facility can view punch history of staff from another facility

The `history` procedure accepts an optional `userId` parameter. When provided, the query fetches punches for that userId without verifying the requesting user and the target share at least one facility. Any authenticated staff member can query any other staff member's complete punch history.

The `punch` procedure at line 76 uses `EmploymentProfile` to resolve facility, but `history` does not.

**Fix**: Before querying, verify that the requesting user and the target userId share at least one facility. Fetch the target user's facilities and intersect with `ctx.session.facilityIds`.

---

### MEDIUM

#### M1. ShiftRegistration.supersededById: self-referential FK without relation

**File**: `prisma/schema.prisma` line 1490
**Severity**: MEDIUM -- no referential integrity on supersede chain

`supersededById` references another `ShiftRegistration` but has no `@relation` defined. Prisma won't create a FK constraint. A supersededById can point to a deleted registration.

**Fix**: Add `@relation("ShiftRegistrationSupersede", fields: [supersededById], references: [id], onDelete: SetNull)`. Requires naming the relation since it's self-referential.

---

#### M2. Seed data has no shift models

**File**: `packages/db/src/seed.ts`, `seed-demo.ts`, `seed-lms.ts`
**Severity**: MEDIUM -- fresh development environment has zero shift groups/templates

None of the seed files reference ShiftGroup, ShiftTemplate, ShiftRegistration, ShiftRegistrationEntry, TimePunch, FacilityNetwork, or ShiftCodeCounter. A new developer running `prisma db seed` will have an empty shift system. The CheckInPanel and ShiftRegListPanel will show empty states with no actionable configuration.

**Fix**: Add seed entries for at least:
- 2-3 ShiftGroups (KINH_DOANH, GIAO_VIEN) with selection modes
- 2-3 ShiftTemplates per group (CA_SANG, CA_CHIEU, CA_TOI)
- 1 FacilityNetwork per seeded facility (e.g., 0.0.0.0/0 for dev)
No seed registrations or punches needed.

---

#### M3. ShiftGroup.selectionMode is free-text string, not enum

**File**: `prisma/schema.prisma` line 1427
**Severity**: MEDIUM -- DB allows arbitrary values; only validated at app layer

`selectionMode` is declared as `String` with a comment saying "SINGLE | MULTIPLE". The Zod validator in shift-config.ts line 31 enforces `z.enum(['SINGLE', 'MULTIPLE'])`, but the DB itself has no constraint. A raw SQL insert could put arbitrary values.

**Fix**: Either (a) create a Prisma enum `ShiftSelectionMode` with values `SINGLE` and `MULTIPLE`, or (b) add a `@db.VarChar(10)` and rely on the app layer. Option (a) is safer.

---

#### M4. resolveShiftGroup uses brittle string-includes matching

**File**: `apps/api/src/routers/shift-registration.ts` lines 10-15
**Severity**: MEDIUM -- fragile role-to-group resolution

The function uses `position.includes(r)` to match roles against a position string. While it currently works (role names don't overlap), this pattern is brittle. For example, if a position "lead_teacher" is ever introduced, it would incorrectly match `head_teacher`.

**Fix**: Use an exact set lookup or switch statement based on role enum values, not substring matching.

---

#### M5. ShiftTemplate @@unique([shiftGroupId, startTime]) does not prevent overlapping intervals

**File**: `prisma/schema.prisma` line 1461
**Severity**: MEDIUM -- overlapping shifts can be created within same group

Two templates with start/end times 08:00-12:00 and 11:00-15:00 have different start times ("08:00" vs "11:00"), so the unique constraint passes. Both can be selected for the same day, resulting in overlapping work hours. The app layer doesn't validate non-overlapping intervals either.

**Fix**: Add application-level overlap validation in shift-config.ts `createTemplate` mutation, or accept overlapping as a valid configuration (e.g., for float/flex shifts).

---

#### M6. No TimePunch relation to ShiftRegistrationEntry

**File**: `prisma/schema.prisma` lines 1524-1543 (TimePunch model)
**Severity**: MEDIUM -- punch-to-shift linkage is implicit (by date+user query), not explicit (by FK)

The `todayStatus` procedure (check-in-out.ts line 146-152) links punches to shifts by querying: "find approved registration for this user on today's date." If a bug creates two approved registrations for the same user+date, the query is ambiguous. An explicit FK from TimePunch to ShiftRegistrationEntry would make the linkage provable and auditable.

**Fix**: Add `shiftRegistrationEntryId String? @map("shift_registration_entry_id") @db.Uuid` to TimePunch with an optional relation. Populate it at punch time when the matching registration entry exists.

---

### LOW

#### L1. checkInOut.checkIP has no permission gate

**File**: `apps/api/src/routers/check-in-out.ts` line 63
**Severity**: LOW -- only reads network config; authenticated-only gate is sufficient

The `checkIP` procedure uses `protectedProcedure` (logged-in only) without `requirePermission`. It only queries FacilityNetwork records, which is low-sensitivity. Intended as a pre-flight check for the punch button. Acceptable as-is.

---

#### L2. ShiftCodeCounter has no explanatory comment (minor)

**File**: `prisma/schema.prisma` lines 1561-1568
**Severity**: LOW -- cosmetic; the counter pattern is well-established elsewhere

`BatchCodeCounter` and `ReceiptCodeCounter` both follow the same `(facilityId, year)` pattern without comments, so this is consistent. No fix needed.

---

#### L3. lateMinutes function has dead code (UTC vs local time confusion)

**File**: `apps/api/src/routers/check-in-out.ts` lines 44-51
**Severity**: LOW -- dead code, no functional impact

`lateMinutes` computes `startMinutes` using `getUTCHours`/`getUTCMinutes` on line 46, then recomputes `localMinutes` with UTC+7 adjustment on line 49. The `startMinutes` variable (line 46) is unused; only `localMinutes` feeds the return value. The `isLate` function on line 29 uses `getHours()`/`getMinutes()` (local time). These two functions use different timezone bases for the same concept.

**Fix**: Align both functions to use the same timezone handling. Document which timezone is assumed.

---

## Positive Observations

1. **StaffNotifEvent enum values are properly emitted**: `shift_reg_submitted` (shift-registration.ts:250), `shift_reg_approved` (line 314), `shift_reg_rejected` (line 342), `manual_punch_pending` (check-in-out.ts:107) are all emitted via `emitStaffNotif()`. No mismatch between Prisma enum and code usage.

2. **Nav registration completeness**: Both `checkin` and `shift-registration` are registered in shell.tsx section keys (line 64-65), have SECTION_TITLES entries (lines 462-463), and NAV_GATES entries (nav-permissions.ts lines 103-104). App.tsx has render cases for both (lines 807-816).

3. **Permission registry entry count matches router procedures** for `shiftReg` (9 entries, all matched), `facilityNetwork` (3 entries, all matched), and `checkInOut.checkIn`/`todayStatus`/`history`/`approveManual` (4 of 6 OK). The mismatch is just the 4 orphaned entries (C2).

4. **Router index.ts imports are complete**: All four new routers are imported and registered (lines 33-36, 71-74). The UI index.tsx does not need new exports since shift/checkin components are in `apps/admin/src/` (app-level panels, not reusable UI kit).

5. **Schema cascade behavior is correct**: ShiftGroup → ShiftTemplate (Cascade), ShiftRegistration → ShiftRegistrationEntry (Cascade). ShiftRegistration → ShiftGroup (Restrict -- cannot delete a group with active registrations, which is implicit/default behavior since no `onDelete` is specified on the ShiftRegistration.shiftGroup relation). ShiftTemplate ← ShiftRegistrationEntry (no onDelete specified = Restrict default, correct: can't delete a template if entries reference it).

---

## Summary

| Severity | Count | Must-fix before merge |
|---|---|---|
| CRITICAL | 4 | All 4 |
| HIGH | 4 | H1, H2, H3, H4 |
| MEDIUM | 6 | M1 recommended; M2-M6 at discretion |
| LOW | 3 | None blocking |

**Immediate actions**:
1. Update `permission-snapshot.json` with all 21 entries (C1)
2. Remove or implement orphaned permission entries (C2)
3. Add `shiftConfig.createTemplate` to PERMISSIONS (C3)
4. Align `shiftReg` → `shiftRegistration` permission key (C4)
5. Fix ShiftTemplate unique constraint (H3)
6. Add facility-boundary check to checkInOut.history (H4)

**Unresolved Questions**:
- Is `checkInOut.monthlyReport` a planned feature? If yes, add the procedure; if not, remove from PERMISSIONS.
- Should TimePunch have an explicit FK to ShiftRegistrationEntry (M6)? Adds auditability at the cost of tighter coupling.
