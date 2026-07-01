# Code Review Report: Shift & Attendance Backend Routers

- **Review Date**: 2026-06-30
- **Reviewer**: code-reviewer agent
- **Branch**: develop (all 4 router files are untracked; schema + permissions are uncommitted)
- **Files Reviewed**: 6
- **Total LOC**: ~430 (router bodies)

## Scope

| File | Status |
|------|--------|
| `apps/api/src/routers/shift-config.ts` | New (untracked) |
| `apps/api/src/routers/shift-registration.ts` | New (untracked) |
| `apps/api/src/routers/check-in-out.ts` | New (untracked) |
| `apps/api/src/routers/facility-ip.ts` | New (untracked) |
| `apps/api/src/routers/index.ts` | Modified (uncommitted) |
| `packages/auth/src/permissions.ts` | Modified (uncommitted) |
| `packages/db/prisma/schema.prisma` | Modified (uncommitted, +177 lines) |
| `apps/admin/src/nav-permissions.ts` | Modified (uncommitted) |

---

## Critical Issues

### C-1: `checkIP` query uses nonexistent `ctx.db` -- always returns `{ allowed: false }`

- **File/Line**: `check-in-out.ts:67`
- **Severity**: CRITICAL
- **Impact**: The `checkIP` query is the gateway for IP-based check-in validation. It accesses `(ctx as any).db?.facilityNetwork?.findMany(...)` which is always `undefined` because `ApiContext` (defined in `context.ts:9-14`) has no `db` field. The fallback `?? []` means `networks` is always an empty array, so `checkIP` always returns `{ allowed: false, ip: ..., matchedNetwork: null }`. The entire IP-based check-in flow is dead code -- every punch will be flagged as `manual`, every user will require manager approval.
- **Fix**: Replace the raw-Prisma query with a `withRls`-wrapped query:

```typescript
checkIP: protectedProcedure
  .input(z.object({ facilityId: z.number().int().positive() }))
  .query(({ ctx, input }) =>
    withRls(rlsContextOf(ctx.session), async (tx) => {
      const clientIP = ctx.ip; // already resolved in createContext
      const networks = await tx.facilityNetwork.findMany({
        where: { facilityId: input.facilityId, isActive: true, archivedAt: null },
      });
      const allowed = networks.some((n) => ipMatchesCidr(clientIP, n.ipAddress));
      return {
        allowed,
        ip: clientIP,
        matchedNetwork: networks.find((n) => ipMatchesCidr(clientIP, n.ipAddress))?.label ?? null,
      };
    }),
  ),
```

### C-2: `getClientIP` accesses nonexistent request path

- **File/Line**: `check-in-out.ts:19-26`
- **Severity**: CRITICAL
- **Impact**: The function accesses `ctx.req?.raw` which does not exist on `ApiContext`. The Hono context is at `ctx.c`, and `req.raw` is not a Hono API. On the first line it falls through to `c?.req?.header?.('x-real-ip')` which returns `''` (empty), then to XFF parsing which also gets `''` (since the access path is wrong), then returns `'unknown'`. Every punch records IP `'unknown'`. Moreover, the XFF parsing uses `.pop()` (last element, which is correct per the context docs) but the whole function is dead because the initial access chain is wrong.
- **Fix**: Do not reimplement IP extraction. Use `ctx.ip` directly (already resolved correctly in `createContext` at `context.ts:25-27`). Delete `getClientIP` entirely.

### C-3: No RLS migration for any shift-related table

- **File**: `packages/db/prisma/schema.prisma:1422-1567` (uncommitted models); no matching `.sql` migration exists
- **Severity**: CRITICAL
- **Impact**: All 7 new tables (`shift_group`, `shift_template`, `shift_registration`, `shift_registration_entry`, `time_punch`, `facility_network`, `shift_code_counter`) are defined in `schema.prisma` and carry `facilityId` columns, but NO migration enables RLS on them. A grep of all migration SQL files confirms zero mentions of these table names. This means:
  - Users from facility A can read/write data in facility B (no cross-facility isolation).
  - The `withRls(ctx, ...)` wrapper sets `app.facility_ids` but Postgres ignores it because no policy reads it for these tables.
  - A teacher at facility 1 can view/manipulate registrations at facility 2 if they know the UUID.
- **Fix**: Create a migration that enables RLS on all 7 tables with the standard staff isolation policy (mirroring the pattern from `20260623184505_phase4_payroll/migration.sql:90-102`):

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_group','shift_template','shift_registration',
    'shift_registration_entry','time_punch','facility_network','shift_code_counter']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
        WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
    $f$, t);
  END LOOP;
END$$;
```

### C-4: SSE push called inside withRls callback (before tx commit) -- ghost notifications

- **File/Lines**: `shift-registration.ts:255` (submit), `shift-registration.ts:319` (approve), `shift-registration.ts:347` (reject), `check-in-out.ts:112` (punch)
- **Severity**: CRITICAL
- **Impact**: The `emitStaffNotif` return value is explicitly documented as: "Call the returned push() function OUTSIDE the withRls callback (i.e. after the transaction commits). Calling it inside the tx would push ghost notifications to clients if the tx later rolls back." In all 4 mutation sites, `push()` is called inside the `async (tx) => {...}` callback, before the function returns and before `$transaction` commits. If any subsequent `logEvent` call or the tx commit fails, the SSE client has already received a notification for an operation that never persisted.
- **Fix**: Return `push` from the withRls callback and call it after:

```typescript
// Inside submit:
const result = await withRls(rlsContextOf(ctx.session), async (tx) => {
  // ... all mutations and logEvent ...
  const push = /* ... */;
  return { updated, push };
});
result.push(); // called after commit
return result.updated;
```

---

## High Priority Issues

### H-1: Missing ownership checks on shiftRegistration mutations

- **File/Lines**: `shift-registration.ts:225` (submit), `shift-registration.ts:269` (withdraw), `shift-registration.ts:175` (updateEntry)
- **Severity**: HIGH
- **Impact**: These mutations look up the registration by `id` only -- they do NOT verify `userId === ctx.session.userId`. A teacher with `shiftReg.submit` permission can submit (or withdraw, or update entries of) ANY other teacher's draft registration if they know the UUID. Combined with C-3 (no RLS), this extends to cross-facility access.
- **Fix**: Add ownership checks:

```typescript
const reg = await tx.shiftRegistration.findUniqueOrThrow({
  where: { id: input.id },
});
if (reg.userId !== ctx.session.userId) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Không thể thao tác trên phiếu của người khác' });
}
```

Note: `approve` and `reject` intentionally operate on other users' registrations (manager actions), so ownership checks do NOT apply there. However, they should verify the approver is the actual `managerId` or `nextManagerId` of the registration.

### H-2: Fragile substring matching in `resolveShiftGroup`

- **File/Line**: `shift-registration.ts:10-14`
- **Severity**: HIGH
- **Impact**: Uses `String.includes()` for role detection on the free-text `position` column (not an enum). This is fragile:
  - `'sale'.includes('sale')` matches `'wholesale'` if such a position existed
  - `'giao_vien'.includes('giao_vien')` would NOT match `'tro_giang'` (assistant) -- they'd incorrectly fall into KINH_DOANH
  - The position column is a free-text `String` with no enum constraint, so any value is possible
  - If `position` is `null`, the `.includes()` call throws a TypeError (line 11: `position.includes(r)` on null)

  Actually confirmed: if `employmentProfile.position` is `null`, line 11 throws `TypeError: Cannot read properties of null (reading 'includes')`. The employment query at line 142 uses `findUniqueOrThrow` but does NOT validate that `position` is non-null.
- **Fix**: Either:
  1. Add a proper enum/discriminator column to `EmploymentProfile` (e.g., `shiftGroup` with values `'KINH_DOANH' | 'GIAO_VIEN'`)
  2. Or use exact string matching with a whitelist + null guard:

```typescript
function resolveShiftGroup(position: string | null): string {
  if (!position) return 'KINH_DOANH'; // null-safe fallback
  const salesRoles = ['sale', 'cskh', 'ctv_mkt'];
  const teacherRoles = ['giao_vien', 'head_teacher'];
  const parts = position.split(/[\s,]+/);
  if (parts.some((p) => salesRoles.includes(p))) return 'KINH_DOANH';
  if (parts.some((p) => teacherRoles.includes(p))) return 'GIAO_VIEN';
  return 'KINH_DOANH';
}
```

### H-3: `todayStatus` timezone bug -- uses server local time, not Vietnam time

- **File/Lines**: `check-in-out.ts:131-134`, `check-in-out.ts:36-59`
- **Severity**: HIGH
- **Impact**: `new Date()` returns the server's clock time. If the server runs in UTC (standard for production), then:
  - `today.setHours(0,0,0,0)` creates UTC midnight, which is 07:00 Vietnam time
  - A punch at 06:00 Vietnam (23:00 UTC previous day) falls into the previous day's window
  - The `lateMinutes` / `earlyLeaveMinutes` functions use `punchTime.getUTCHours() + 7` to compute VN local time (`(getUTCHours() + 7) % 24`), but then compare against shift times that are assumed to be in VN timezone
  - The result: penalties are computed against the wrong day's shift, or no shift is found when one exists
  - Also: `new Date()` on line 131 (today) uses local time; `new Date()` on line 131 of shift-registration.ts uses the same. If server is UTC, `new Date().getFullYear()` at 00:00-06:59 UTC on Jan 1 would return the PREVIOUS year, producing wrong shift codes.
- **Fix**: Use a consistent UTC+7 date utility throughout:

```typescript
function vnToday(): Date {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600_000);
  vn.setUTCHours(0, 0, 0, 0);
  return new Date(vn.getTime() - 7 * 3600_000); // back to UTC midnight representing VN midnight
}
```

Or adopt `date-fns-tz` or a similar library for timezone-aware date handling.

### H-4: `new Date(YYYY-MM-DD)` for `@db.Date` fields may produce off-by-one

- **File/Lines**: `shift-registration.ts:154-155` (fromDate/toDate), `shift-registration.ts:198,211` (entry date)
- **Severity**: HIGH
- **Impact**: `new Date('2026-06-30')` in a UTC server creates `2026-06-30T00:00:00.000Z` which Prisma correctly sends as Pg `date '2026-06-30'`. However, in a server configured to a non-UTC timezone (or if someone runs it locally in VN timezone), `new Date('2026-06-30')` may produce `2026-06-29T17:00:00.000Z` which when truncated to `@db.Date` becomes `2026-06-29` -- one day off.
- **Fix**: Use `new Date(input.fromDate + 'T00:00:00.000Z')` or a date-fns `parseISO` to ensure consistent UTC interpretation.

---

## Medium Priority Issues

### M-1: Redundant `employmentProfile` query in `punch`

- **File/Lines**: `check-in-out.ts:80` and `check-in-out.ts:99`
- **Severity**: MEDIUM
- **Impact**: The same user's employment profile is fetched twice within the same `withRls` callback. First for `facilityId` (line 80), then for `managerId` (line 99). Both queries hit the same row.
- **Fix**: Combine into a single query at the top:

```typescript
const profile = await tx.employmentProfile.findUniqueOrThrow({
  where: { userId: ctx.session.userId },
  select: { facilityId: true, managerId: true },
});
```

### M-2: `checkIP` has no specific permission gate

- **File/Line**: `check-in-out.ts:63`
- **Severity**: MEDIUM
- **Impact**: `checkIP` uses `protectedProcedure` (any authenticated staff) with no `requirePermission` call. While IP checking is low-sensitivity, other queries like `todayStatus` use `requirePermission('checkInOut', 'todayStatus')`. For consistency and to prevent enumeration of facility IPs, this should be gated.
- **Fix**: Change to `requirePermission('checkInOut', 'checkIn')` or add a dedicated `checkIP` permission entry.

### M-3: Missing `update`/`archive` procedures for shiftConfig despite permission entries

- **File/Line**: `permissions.ts:242-243` declares `update`/`archive` for `shiftConfig`; `shift-config.ts` has no such procedures
- **Severity**: MEDIUM
- **Impact**: The admin UI cannot update or archive shift groups/templates. Frontend calls to these procedures would get "procedure not found" errors. The permission entries are forward-declared but unimplemented.
- **Fix**: Either remove the unused permission entries or implement the procedures. If `createTemplate` is the intended template management path, add `createTemplate` / `updateTemplate` / `archiveTemplate` entries to permissions.

### M-4: `submit` creates code only for current year -- cross-year edge case

- **File/Line**: `shift-registration.ts:234`
- **Severity**: MEDIUM
- **Impact**: The code `SR-YYYY-NNNN` uses `new Date().getFullYear()`. If a late-December draft (fromDate=2026-12-20, toDate=2027-01-10) is submitted on 2027-01-02, the code becomes `SR-2027-NNNN` even though the registration covers Dec 2026. More critically, if the server timezone causes a year rollover during submission (H-3), it could reference a non-existent year.
- **Fix**: Use the `fromDate` year instead of `new Date().getFullYear()`:

```typescript
const year = new Date(reg.fromDate).getUTCFullYear();
```

### M-5: Uninitialized `lastSeq` for new (facilityId, year) pairs may produce duplicate code

- **File/Line**: `shift-registration.ts:235-240`
- **Severity**: MEDIUM
- **Impact**: The UPSERT inserts `last_seq = 1` on conflict-free insert, but on conflict it does `last_seq = shift_code_counter.last_seq + 1`. If the row already has `last_seq = 0` (initialized by `@@id` default), the first UPSERT conflict would set `last_seq = 1`. This is actually correct. However, if two concurrent submits hit the same UPSERT simultaneously, both would see the same RETURNING value due to PostgreSQL's MVCC within a serializable transaction. Since `withRls` uses `prisma.$transaction` (defaults to READ COMMITTED), two concurrent INSERT...ON CONFLICT operations would properly serialize: the second one would wait for the first to commit, then see the updated `last_seq`. But there's a subtle race: if both start before either commits, both would read the old `last_seq` and increment to the same value.

  Actually, PostgreSQL's ON CONFLICT DO UPDATE with RETURNING within a single statement IS atomic even under READ COMMITTED -- the row lock from the conflict ensures serialization. So this is safe. However, the counter table has no RLS (C-3), so any user can increment any facility's counter. If two users from different facilities concurrently submit, their counters won't conflict (different facility_id), no issue.

  The real concern: what happens on the very first submit for a given (facility, year)? The INSERT path sets `last_seq = 1`, and RETURNING returns `1`. Code becomes `SR-YYYY-0001`. Then the second submit conflicts, UPDATEs to `last_seq = 1 + 1 = 2`, RETURNING returns `2`. Code becomes `SR-YYYY-0002`. This is correct sequential numbering. No issue.

  However: if the UPSERT query uses `VALUES ($1, $2, 1)` and `shift_code_counter.last_seq + 1`, the first row inserted gets `last_seq = 1`. The second conflicting row does `last_seq = 1 + 1 = 2`. The RETURNING for the second returns `2`. This is fine. **Verdict: the UPSERT is safe.**

### M-6: `lateMinutes` function has dead intermediate calculation

- **File/Line**: `check-in-out.ts:44-51`
- **Severity**: MEDIUM
- **Impact**: Lines 47-48 compute `punchMinutes` from `getUTCHours()/getUTCMinutes()` but this value is never used -- line 49 overrides with the VN-adjusted `localMinutes`. The dead code is harmless but confusing.
- **Fix**: Remove lines 47-48.

### M-7: `isLate` and `isEarly` use `getHours()` (local time) vs `lateMinutes`/`earlyLeaveMinutes` use `getUTCHours()` (UTC-adjusted for VN)

- **File/Lines**: `check-in-out.ts:29-41` vs `check-in-out.ts:44-59`
- **Severity**: MEDIUM
- **Impact**: `isLate`/`isEarly` use `punchTime.getHours()` which reads the SERVER's local hour. `lateMinutes`/`earlyLeaveMinutes` correctly adjust via `getUTCHours() + 7`. If the server runs in UTC, `getHours()` returns UTC hours, which would be off by 7 from Vietnam time. `isLate`/`isEarly` are defined but never called in the current codebase -- they appear to be intended for future use. The inconsistency is a latent bug.
- **Fix**: Either delete `isLate`/`isEarly` (unused) or fix them to use the same UTC+7 adjustment as `lateMinutes`/`earlyLeaveMinutes`.

---

## Low Priority Issues

### L-1: `facilityNetwork.delete` is a soft-delete but named "delete"

- **File/Line**: `facility-ip.ts:46-65`
- **Severity**: LOW
- **Impact**: The procedure sets `archivedAt` and `isActive = false` (soft-delete) but is named `delete`. All other routers in this codebase use soft-delete with `archive` naming. Inconsistency with the audit event type `'archived'` (line 59).
- **Fix**: Rename to `archive` for consistency with codebase conventions and the permission registry (which also uses `delete`).

### L-2: `getClientIP` duplicates logic from `createContext`

- **File/Line**: `check-in-out.ts:19-26`, `context.ts:25-27`
- **Severity**: LOW
- **Impact**: IP extraction is already done correctly in `createContext` and stored in `ctx.ip`. The `getClientIP` function reimplements this (incorrectly) and should be deleted.
- **Fix**: Delete `getClientIP`, use `ctx.ip` everywhere.

### L-3: Nav gates for `checkin` and `shift-registration` are `open`

- **File/Line**: `nav-permissions.ts:103-104`
- **Severity**: LOW
- **Impact**: Both nav panels are gated as `{ kind: 'open' }` meaning any authenticated staff sees them in the sidebar. When a staff member without permission clicks, every action returns FORBIDDEN (backend gating works correctly). This is a UX degrade, not a security issue, but inconsistent with other panels like `assessment` which gates on the primary work action.
- **Fix**: Gate on the primary action: `{ kind: 'permission', module: 'checkInOut', action: 'checkIn' }` and `{ kind: 'permission', module: 'shiftReg', action: 'create' }`.

### L-4: Dynamic import of `emitStaffNotif` inside transaction

- **File/Line**: `check-in-out.ts:104`
- **Severity**: LOW
- **Impact**: `await import('../lib/emit-staff-notif.js')` dynamically inside the withRls callback. Most JS runtimes cache module imports, so this is only parsed once per process. However, it's unusual to have a dynamic import inside a critical-path database transaction. It should be a static import at the top of the file (matching the pattern in `shift-registration.ts:7`).
- **Fix**: Move to a static import: `import { emitStaffNotif } from '../lib/emit-staff-notif.js';`

### L-5: `resolveManager` for non-sales/non-teacher roles returns null for both managers

- **File/Line**: `shift-registration.ts:41-55`
- **Severity**: LOW
- **Impact**: If a user has roles like `['ke_toan', 'hr']` (no sales or teacher roles), `directorRole` is `null`, and the function returns `{ managerId: null, nextManagerId: null }`. The registration is created with no manager to approve. When submitted, line 247 `if (reg.managerId)` is false, so no notification is sent and no one knows to approve.
- **Fix**: For non-teaching/non-sales roles, fall back to `bgd` or `quan_ly` as approver, or throw a clear error if the user lacks a resolvable manager.

### L-6: `approveManual` does not verify the approver manages the punch's user

- **File/Line**: `check-in-out.ts:173-192`
- **Severity**: LOW
- **Impact**: Any user with `checkInOut.approveManual` permission can approve ANY manual punch, even for a user in a different department/facility. Combined with C-3 (no RLS), this enables cross-facility approval. Manager scope should be verified.
- **Fix**: Verify the approver's employment profile manages the punch's user, or at minimum that they share a facility.

---

## Checklist Items Addressed

### Shift Code Counter UPSERT -- Is it safe?

Yes, the UPSERT (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`) is a single atomic PostgreSQL statement. The row lock from the conflict ensures serialization under READ COMMITTED. The RETURNING clause correctly returns the incremented value. No SQL injection -- parameterized with `$1, $2`. **Safe.**

### ResolveShiftGroup Logic -- Is position string matching correct?

No. `String.includes()` is fragile, fails on `null` positions with TypeError, and does substring matching instead of exact role matching. See H-2.

### ResolveManager Logic -- Does it handle all edge cases?

Partially. It handles the `managerId` null case (resolves by role), the chain case (manager's manager), and the bgd fallback. However:
- Non-sales/non-teacher roles get `null` managers with no bgd fallback (L-5)
- The `bgd` fallback is queried unconditionally (line 32) then again in the else branch (line 50) -- redundant double query
- If `employmentProfile.managerId` points to a deleted/inactive user, the chain silently breaks

### GetClientIP -- Does it correctly extract IP?

No. It accesses `ctx.req?.raw` which doesn't exist. Even when falling through to `ctx.c?.req?.header?.(...)`, the optional chaining means it silently returns `''` instead of the real IP. See C-2.

### LateMinutes/EarlyLeaveMinutes Timezone Handling

The VN timezone adjustment `(getUTCHours() + 7) % 24` is correct for UTC+7, but the `% 24` operation causes hours 17-23 to wrap to 0-6 (next day), which is wrong for late-night shifts ending at e.g. 22:00. Example: a shift ends at 22:00 VN (15:00 UTC), a punch at 21:00 VN (14:00 UTC). `(14 + 7) % 24 = 21`. `Math.max(0, 22 - 21) = 1` early minute. This is correct. But for a punch at 01:00 VN (18:00 UTC previous day): `(18 + 7) % 24 = 1`. `Math.max(0, 22 - 1) = 21` early minutes -- this is the previous day's shift ending at 22:00, and the punch is 21 hours "early" the next day. The core issue is that timezone adjustment without date awareness cannot handle overnight shifts. The `% 24` is wrong -- it should just be `getUTCHours() + 7` (no modulo, since 0-23+7 gives 7-30, which means 7-30 Vietnam hours). A shift ending at 22:00 with a punch at 01:00 VN (next day) would give `(18+7) = 25` minutes, `Math.max(0, 22 - 25) = 0`. But `25` hours doesn't make sense either. The `% 24` modulo was an attempt to normalize but it breaks the comparison.

Recommendation: Use a proper timezone library (`date-fns-tz`, `luxon`) instead of manual arithmetic.

### CheckIP Query -- Does it bypass RLS correctly?

It doesn't bypass RLS -- it bypasses `withRls` entirely. `facility_network` has no RLS policy (C-3), so there's nothing to bypass. However, the raw `ctx.db` access is a runtime error, making the entire query return empty results. See C-1.

### Punch Method -- Check for existing approved shift?

The `punch` method does NOT check for an existing approved shift. It creates a `TimePunch` regardless. The `todayStatus` query later checks for an approved shift to compute penalties. This means:
- A user can punch even without any approved shift registration
- The `shiftTemplateId` on `TimePunch` is never set (always null)
- This may be intentional ("punch first, map to shift later") but is not documented

### Submit Mutation -- Is the code counter atomic?

Yes. PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` is atomic. See checklist above.

### Approve Mutation -- Does supersede logic work correctly?

Partially. The current logic (lines 297-306):
1. Finds ONE existing approved registration for the same user
2. Cancels it with `supersededById` pointing to the new registration
3. Approves the new registration

Issues:
- Only supersedes the FIRST matching approved registration -- if there are multiple (shouldn't happen but possible with concurrent approvals), only one gets cancelled
- Does NOT filter by date range: an old approved registration from 6 months ago could be superseded by today's new submission
- The `supersededAt` timestamp is set but the future dates from the old registration are NOT cancelled individually -- the old registration's entries remain active unless the consuming query filters by `status: 'approved'`

---

## Verification Commands

Before merging, run:

```bash
# Type-check API
cd D:/project/CMCnew && npx tsc --noEmit -p apps/api/tsconfig.json

# Permission parity test
cd D:/project/CMCnew && npx vitest run apps/api/test/permission-parity.test.ts

# Verify no schema drift
cd D:/project/CMCnew && npx prisma validate --schema packages/db/prisma/schema.prisma
```

---

## Metrics

- **CRITICAL issues**: 4 (broken IP check, broken IP extraction, no RLS, ghost notifications)
- **HIGH issues**: 4 (ownership checks, fragile matching, timezone, date off-by-one)
- **MEDIUM issues**: 7
- **LOW issues**: 6
- **New tables without RLS**: 7 out of 7
- **Linting**: Not run (need to install deps)
- **Type coverage**: Unknown -- `any` casts found at `check-in-out.ts:67` (`ctx as any`), `shift-registration.ts:19` (`tx: any`)

---

## Unresolved Questions

1. Should `shift_code_counter` have RLS? It's a system table without user-level data, but facility isolation might still be desirable.
2. Is the `punch` method intentionally not linking to a `ShiftTemplate`? The `TimePunch.shiftTemplateId` field exists but is never populated.
3. Should `approve` also check that the approver is the `managerId` or `nextManagerId` of the registration? Currently it only prevents self-approval but allows any manager-role user to approve any submission.
4. Should `timePunch` enforce one-check-in-per-day uniqueness? Currently a user can punch unlimited times, and `todayStatus` uses first=check-in, last=check-out. Bogus intermediate punches are not validated.
