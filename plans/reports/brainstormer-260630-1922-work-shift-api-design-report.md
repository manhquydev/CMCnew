# Work Shift Registration + Attendance API Design Report

**Status**: Draft for review
**Date**: 2026-06-30
**Agent**: brainstormer
**Context**: API design for DANG KY CONG CA + CHAM CONG modules in CMCnew ERP

---

## Table of Contents
1. [Router Structure & Procedure Design](#1-router-structure--procedure-design)
2. [Permission Model](#2-permission-model)
3. [Integration Flow with KPI & Payslip](#3-integration-flow-with-kpi--payslip)
4. [IP Validation Middleware](#4-ip-validation-middleware)
5. [Database Schema (new models)](#5-database-schema-new-models)
6. [Unresolved Questions](#6-unresolved-questions)

---

## 1. Router Structure & Procedure Design

### Router Tree

```
appRouter
  shiftConfig: shiftConfigRouter     // Danh muc ca
  shiftRegistration: shiftRegRouter  // Phieu dang ky cong ca
  checkInOut: checkInOutRouter       // Cham cong
  facilityIp: facilityIpRouter       // Cau hinh IP
```

### 1.1 shiftConfigRouter -- Danh muc ca lam viec

CRUD danh muc ca theo facility. Pattern: giong facilityRouter (CRUD co ban).

Procedures:
- list: query danh sach ca (requirePermission shiftConfig.list)
- create: mutation tao ca moi (requirePermission shiftConfig.create)  
- update: mutation cap nhat ca (requirePermission shiftConfig.update)
- archive: mutation xoa mem ca (requirePermission shiftConfig.archive)

Input schemas:
- create: { facilityId, name, group (sales|teacher), startTime (HH:mm), endTime (HH:mm), hours, color? }
- update: { id, ...partial<create> }
- archive: { id } -- kiem tra ca co dang duoc dung trong phieu draft/submitted khong

Key decisions:
- list returns active (non-archived) shifts only
- archive validates no active usage in draft/submitted registrations
- color is optional hex for calendar display
- group discriminates sales vs teacher shift types; system infers group from EmploymentProfile.position or AppUser.roles

---

### 1.2 shiftRegRouter -- Phieu dang ky cong ca

Workflow: **Draft -> Submitted -> Approved** (or Draft <- Rejected, Approved -> Cancelled).
Pattern: mirrors kpiEval* workflow in payroll router.

Procedures (Query):
- list: management view (requirePermission shiftRegistration.list) -- filter by facilityId, userId?, status?, month?
- myRegistrations: self-service (protectedProcedure) -- own registrations only
- get: detail of one registration with all day assignments (requirePermission shiftRegistration.get)
- getRegisteredShifts: approved shifts for calendar/attendance display (protectedProcedure)

Procedures (Mutation):
- create: protectedProcedure -- auto-generates ShiftRegistrationDay rows for date range; overlap check; creates in Draft status
- updateDay: protectedProcedure -- update shift for one day; ownership + draft status check
- submit: protectedProcedure -- Draft->Submitted; validates >=1 day assigned; notifies facility managers
- approve: requirePermission shiftRegistration.approve -- Submitted->Approved; cannot self-approve; notifies owner
- reject: requirePermission shiftRegistration.reject -- Submitted->Draft; mandatory reason; notifies owner
- cancel: requirePermission shiftRegistration.cancel -- Approved->Cancelled

Input schemas:
- create: { facilityId, fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD), note? } -- refined: fromDate <= toDate
- updateDay: { registrationDayId, shiftConfigId?, isDayOff?, note? }
- submit: { id }
- approve: { id }
- reject: { id, reason (min 1) }
- cancel: { id }

Key decisions:
- create auto-generates ShiftRegistrationDay rows for every day in range
- Each updateDay call is a direct DB write -- no separate save procedure
- submit validates at least 1 day is assigned (or marked day-off)
- reject requires mandatory reason
- Staff notifications follow existing emitStaffNotif pattern (persist in tx, push after commit via setTimeout)
- Separation of duties: approve blocks self-approval

---

### 1.3 checkInOutRouter -- Cham cong

Procedures:
- checkIn: protectedProcedure -- creates/updates today record; validates facility IP; idempotent (upsert)
- checkOut: protectedProcedure -- updates today record; no IP validation (staff may leave remotely)
- todayStatus: protectedProcedure -- returns check-in/out status for current user today
- history: requirePermission checkInOut.history -- attendance history; staff see own, managers see any
- monthlyReport: requirePermission checkInOut.monthlyReport -- compares actual vs registered shifts
- workdaysCount: requirePermission checkInOut.workdaysCount -- reference data for payslip

Input schemas:
- checkIn: { facilityId, note? }
- checkOut: { facilityId, note? }
- todayStatus: { facilityId }
- history: { facilityId, userId?, fromDate?, toDate? }
- monthlyReport: { facilityId, periodKey (YYYY-MM), userId? }
- workdaysCount: { userId, facilityId, periodKey }

Key decisions:
- checkIn is upsert-idempotent (update existing or create new)
- IP validation calls inline validateCheckInIp() function -- NOT global middleware
- checkOut does NOT validate IP
- monthlyReport computes: registered days, work days, late days, absent days
- The history/monthlyReport endpoints default userId to ctx.session.userId when not provided
  (management roles can pass explicit userId for cross-staff queries)

---

### 1.4 facilityIpRouter -- Cau hinh IP cong ty

Procedures:
- list: requirePermission facilityIp.list -- active IPs for a facility
- create: requirePermission facilityIp.create -- add IP/CIDR with optional label
- delete: requirePermission facilityIp.delete -- soft-delete (set isActive=false)

Input schemas:
- create: { facilityId, ipAddress, label? }
- delete: { id }

Key decisions:
- Super admin only (infrastructure security surface)
- Supports CIDR notation (e.g. "192.168.1.0/24")
- Soft-delete pattern (isActive=false) matching codebase convention

---

## 2. Permission Model

### 2.1 PERMISSIONS registry additions (packages/auth/src/permissions.ts)

```typescript
shiftConfig: {
  list:    ["hr", "ke_toan", "quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  create:  ["hr", "ke_toan"],
  update:  ["hr", "ke_toan"],
  archive: ["hr", "ke_toan"],
},

shiftRegistration: {
  list:    ["hr", "ke_toan", "quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  get:     ["hr", "ke_toan", "quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  approve: ["quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  reject:  ["quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  cancel:  ["hr", "ke_toan", "quan_ly"],
},

checkInOut: {
  history:        ["hr", "ke_toan", "quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  monthlyReport:  ["hr", "ke_toan", "quan_ly", "giam_doc_kinh_doanh", "giam_doc_dao_tao"],
  workdaysCount:  ["hr", "ke_toan"],
},

facilityIp: {
  list:   ["super_admin"],
  create: ["super_admin"],
  delete: ["super_admin"],
},
```

### 2.2 Authorization matrix

| Action | Staff (self) | Manager | HR/KeToan | Director | SuperAdmin |
|--------|:---:|:---:|:---:|:---:|:---:|
| shiftConfig.list | - | Read | Read | Read | Read |
| shiftConfig.create/update/archive | - | - | Write | - | Write |
| shiftReg.create/submit/updateDay | Write (self) | Write (self) | Write (self) | Write (self) | Write |
| shiftReg.list/get | - | Read (facility) | Read (facility) | Read | Read |
| shiftReg.approve/reject | - | Write (not self) | - | Write (not self) | Write |
| shiftReg.cancel | - | Write | Write | - | Write |
| checkIn/checkOut/todayStatus | Write (self) | Write (self) | Write (self) | Write (self) | Write |
| checkInOut.history/monthlyReport | Read (self) | Read (facility) | Read (facility) | Read (facility) | Read |
| checkInOut.workdaysCount | - | - | Read | - | Read |
| facilityIp.* | - | - | - | - | Read/Write |

### 2.3 Self-service vs management pattern

Mirrors existing payroll.myPayslips vs payroll.payslipList:

**Self-service** (protectedProcedure): userId from session, no userId input accepted.
- checkIn, checkOut, todayStatus
- myRegistrations, getRegisteredShifts
- shiftRegistration.create, updateDay, submit (ownership checked in body)

**Management** (requirePermission): optional userId input for cross-staff queries.
- history, monthlyReport, workdaysCount
- shiftRegistration.list, get
- shiftRegistration.approve, reject, cancel

---

## 3. Integration Flow with KPI & Payslip

### 3.1 KPI Integration: chuyen_can + di_muon criteria

**Data source**: StaffCheckInOut records + ShiftRegistrationDay (approved shifts).

**Flow**:
```
StaffCheckInOut (actual) + ShiftRegistrationDay (registered)
  -> monthlyReport aggregate
    -> kpiAutoPrefill populates chuyen_can and di_muon scores
```

**Implementation** (extension to existing kpiAutoPrefill in payroll router, for training block only):

```typescript
// Within kpiAutoPrefill, training block:

// Get actual check-in data for the period
const checkins = await tx.staffCheckInOut.findMany({
  where: { userId: input.userId, facilityId: input.facilityId, date: { gte: start, lt: end } },
});
const workDays = checkins.filter((c) => c.checkInAt && c.checkOutAt).length;

// Build a map of date -> registered shift startTime for late detection
const regDaysMap = new Map(
  (await tx.shiftRegistrationDay.findMany({
    where: {
      date: { gte: start, lt: end },
      registration: { userId: input.userId, facilityId: input.facilityId, status: 'approved' },
    },
    include: { shiftConfig: { select: { startTime: true } } },
  })).map((d) => [d.date.toISOString().slice(0, 10), d.shiftConfig?.startTime])
);

// Count late days: check-in time > registered shift start
let lateCount = 0;
for (const c of checkins) {
  if (!c.checkInAt) continue;
  const dateKey = c.date.toISOString().slice(0, 10);
  const shiftStart = regDaysMap.get(dateKey);
  if (shiftStart && c.checkInAt.toISOString().slice(11, 16) > shiftStart) lateCount++;
}

// Count total registered working days
const registeredDays = await tx.shiftRegistrationDay.count({
  where: {
    date: { gte: start, lt: end },
    registration: { userId: input.userId, facilityId: input.facilityId, status: 'approved' },
    shiftConfigId: { not: null },
  },
});

// Compute scores
const chuyenCanScore = registeredDays > 0
  ? Math.round((workDays / registeredDays) * 100 * 100) / 100
  : 0;

const diMuonScore = workDays > 0
  ? Math.max(0, 100 - (lateCount / workDays) * 50)
  : 0;

computed.push(
  { key: 'chuyen_can', score: chuyenCanScore, dataAvailable: registeredDays > 0 },
  { key: 'di_muon', score: diMuonScore, dataAvailable: workDays > 0 },
);
```

**KPI criteria config** (in CompensationPolicy.params.kpiCriteria.training):
```json
{
  "training": [
    { "key": "chuyen_mon", "weight": 0.4 },
    { "key": "tuan_thu",  "weight": 0.2 },
    { "key": "chuyen_can", "weight": 0.25 },
    { "key": "di_muon",   "weight": 0.15 }
  ]
}
```

**Important**: These keys and weights must exist in the CompensationPolicy params. Missing keys are silently dropped (matching existing kpiAutoPrefill behavior -- no errors for unknown keys).

### 3.2 Payslip Integration: workdays from attendance

**Current flow**: HR manually inputs workdays into payslipCompute.

**Enhancement**: workdaysCount query as reference data (checkInOut.workdaysCount).

```typescript
// checkInOut.workdaysCount returns:
{
  workDays: number,     // actual days with both checkInAt AND checkOutAt
  standardDays: number  // registered approved shift days (excluding day-off)
}
```

**HR workflow**:
1. HR calls checkInOut.workdaysCount to get actual workdays + standard days
2. HR fills workdays into payslipCompute (can override for leave, business trips)

**Why NOT auto-wire**: HR must be able to override for:
- Paid leave days (counted as workdays even though no check-in)
- Business trips (off-site, no office check-in)
- Overtime hours (extra workdays beyond registration)
- Half-day absences

Auto-wiring would silently produce incorrect payslips, and the correction mechanism (reopen finalized payslip) is intentionally limited.

### 3.3 StaffNotification events (new)

Added to StaffNotifEvent enum in Prisma schema:

```prisma
enum StaffNotifEvent {
  // ... existing ...
  shift_pending_approval   // NEW: needs manager approval
  shift_approved           // NEW: registration approved
  shift_rejected           // NEW: registration rejected
}
```

**Trigger points**:
| Event | Trigger | When | Recipients |
|-------|---------|------|------------|
| shift_pending_approval | shiftReg.submit | After submit success | All quan_ly + directors in facility |
| shift_approved | shiftReg.approve | After approval success | Registration owner (reg.userId) |
| shift_rejected | shiftReg.reject | After rejection success | Registration owner |

**Pattern**: follows existing emitStaffNotif design:
1. Persist StaffNotification rows inside transaction
2. Return push function
3. Call push() after withRls commits (via setTimeout)

---

## 4. IP Validation Middleware

### 4.1 Decision: Inline function, NOT global middleware

| Approach | Pros | Cons |
|----------|------|------|
| **Global tRPC middleware** | Centralized, automatic | Applies to ALL 50+ procedures; needs exclusion list; adds 1 DB query to every request; irrelevant for 90% of endpoints |
| **Inline function (CHOSEN)** | Only where needed; clear locality; scoped DB query | Must call explicitly in 2 handlers (checkIn, checkOut) |
| **Procedure decorator/wrapper** | Reusable across endpoints | Over-abstraction for exactly 2 endpoints; adds indirection |

**Chosen**: Inline function. YAGNI -- exactly 2 procedures need IP validation.

### 4.2 Implementation

File: **apps/api/src/lib/check-in-ip.ts**

```typescript
import type { Prisma } from '@cmc/db';

type PrismaTx = Prisma.TransactionClient;

/**
 * Validate client IP against facility IP whitelist.
 * - Localhost (127.0.0.1, ::1, unknown) always allowed (dev/testing).
 * - Each FacilityIp row stores an IP or CIDR prefix (e.g. "192.168.1.0/24").
 * - Returns true if any entry matches; false if no whitelist exists (fail-closed).
 */
export async function validateCheckInIp(
  tx: PrismaTx,
  facilityId: number,
  clientIp: string,
): Promise<boolean> {
  // Localhost always allowed
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'unknown') {
    return true;
  }

  const whitelist = await tx.facilityIp.findMany({
    where: { facilityId, isActive: true },
    select: { ipAddress: true },
  });

  // No whitelist configured -> fail-closed (production safety)
  if (whitelist.length === 0) return false;

  return whitelist.some((entry) => ipMatchesCidr(clientIp, entry.ipAddress));
}

/**
 * Check if an IPv4 address matches a CIDR prefix or exact match.
 * Supports: "192.168.1.100", "192.168.1.0/24", "10.0.0.0/8"
 */
function ipMatchesCidr(clientIp: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    return clientIp === cidr;
  }

  const [rangeIp, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr!, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const clientParts = clientIp.split('.').map(Number);
  const rangeParts = rangeIp!.split('.').map(Number);
  if (clientParts.length !== 4 || rangeParts.length !== 4) return false;

  const clientNum = (clientParts[0]! << 24) | (clientParts[1]! << 16) | (clientParts[2]! << 8) | clientParts[3]!;
  const rangeNum = (rangeParts[0]! << 24) | (rangeParts[1]! << 16) | (rangeParts[2]! << 8) | rangeParts[3]!;
  const mask = ~((1 << (32 - bits)) - 1);

  return (clientNum & mask) === (rangeNum & mask);
}
```

### 4.3 IP source (already in context.ts)

The client IP is already reliably extracted in apps/api/src/context.ts:

```typescript
// X-Real-IP set by nginx to $remote_addr (actual TCP peer, not forgeable)
const xff = c.req.header('x-forwarded-for');
const xffLast = xff ? xff.split(',').pop()?.trim() : undefined;
const ip = c.req.header('x-real-ip')?.trim() || xffLast || 'unknown';
```

This is secure because nginx sets X-Real-IP to the real TCP peer address (the connecting client's public IP). The client cannot forge this header -- nginx overwrites any pre-existing X-Real-IP value.

### 4.4 Usage in checkIn

```typescript
const ipAllowed = await validateCheckInIp(tx, input.facilityId, ctx.ip);
if (!ipAllowed) {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'IP khong duoc phep cham cong. Vui long ket noi mang cong ty.',
  });
}
```

### 4.5 checkOut does NOT validate IP

Design decision: only check-in requires IP validation. Staff may leave the office and check out remotely (e.g., from phone at home after leaving work). This asymmetry is intentional and documented.

---

## 5. Database Schema (new models)

### 5.1 Prisma schema additions

See the GitHub-style code blocks in the full report for complete Prisma definitions.

**New models (5 total):**

- **ShiftConfig** — Shift type catalog per facility. Fields: id, facilityId, name, group (sales|teacher), startTime, endTime, hours, color, isActive, archivedAt. Unique on (facilityId, name).
- **ShiftRegStatus** enum — draft, submitted, approved, cancelled.
- **ShiftRegistration** — Registration header. Fields: id, facilityId, userId, fromDate, toDate, status, note, submittedAt, approvedById/At, rejectedById/At/reason, cancelledAt, createdById. Indexed on (facilityId, status) and (userId).
- **ShiftRegistrationDay** — Individual day within a registration. Fields: id, registrationId (FK cascade), date, shiftConfigId (FK setNull), isDayOff, note. Unique on (registrationId, date).
- **ShiftRegStatus** enum — draft, submitted, approved, cancelled.
- **StaffCheckInOut** — Check-in/out records. Fields: id, facilityId, userId, date, checkInAt, checkOutAt, checkInIp, checkOutIp, status (pending|checked_in|checked_out|absent), note. Unique on (userId, date).
- **FacilityIp** — IP whitelist. Fields: id, facilityId, ipAddress (supports CIDR), label, isActive. Unique on (facilityId, ipAddress).

All models are facility-scoped; no FK to AppUser (matching EmploymentProfile pattern).
All use soft-delete via archivedAt/isActive (matching codebase convention).

### 5.2 RLS policies

Migration must enable RLS on all 5 new tables matching the existing principal_aware_rls pattern.

### 5.3 Enum additions

StaffNotifEvent: add shift_pending_approval, shift_approved, shift_rejected.

---

## 6. Unresolved Questions

1. **Reporting line for approval routing**: Currently notifies ALL managers in facility. When EmploymentProfile.managerId exists, should narrow to direct manager. Implement now or defer?

2. **Auto-create daily check-in records**: Should a cron pre-create StaffCheckInOut (status=pending) for every active staff each day? Current design: record created on first check-in. YAGNI for v1.

3. **Multiple shifts per day**: Current ShiftRegistrationDay allows 1 shift per day (shiftConfigId is singular). Is multi-shift-per-day required? If yes, need a join table instead of scalar FK.

4. **Position-to-group mapping**: ShiftConfig.group is sales/teacher but EmploymentProfile.position is free-text. Proposal: derive from AppUser.roles (if Role.sale present -> sales group; else -> teacher). Or add block enum to EmploymentProfile.

5. **IP validation for check-out**: Only check-in requires IP validation. Check-out does NOT (staff may leave remotely). Is this asymmetry intentional?

6. **Cross-month registrations**: Registration spanning two months (e.g., Jul 25 to Aug 5) is currently allowed. Should each month require its own registration?

7. **Auto-wire workdays into payslip**: Keep manual HR input + workdaysCount reference query. Auto-wiring is high-risk (leave, business trips, OT). Confirm this approach?

---

## Appendix A: Router index.ts changes



## Appendix B: New files to create

| File | Purpose |
|------|---------|
| apps/api/src/routers/shift-config.ts | ShiftConfig CRUD router |
| apps/api/src/routers/shift-registration.ts | ShiftRegistration workflow router |
| apps/api/src/routers/check-in-out.ts | Check-in/out + reporting router |
| apps/api/src/routers/facility-ip.ts | FacilityIP CRUD router |
| apps/api/src/lib/check-in-ip.ts | IP validation helper (CIDR matching) |
| packages/db/prisma/migrations/<ts>_work_shift_attendance/migration.sql | DB schema + RLS migration |
| packages/auth/src/permissions.ts | Add 4 permission groups to PERMISSIONS registry |

## Appendix C: Integration flow diagram





+------------------------------------------------------------------+
|                     WORK SHIFT SYSTEM                             |
+------------------------------------------------------------------+
|                                                                   |
|  shiftConfigRouter          shiftRegRouter                       |
|  +--------------+          +----------------------+              |
|  | list/create   |          | create -> Draft      |              |
|  | update/archive|          | updateDay (per day) |              |
|  +--------------+          | submit -> Submitted  |              |
|                             | approve -> Approved  |--+           |
|  facilityIpRouter           | reject -> Draft      |  |           |
|  +--------------+          | cancel -> Cancelled  |  |           |
|  | list/create   |          +----------------------+  |           |
|  | delete        |                                     |           |
|  +------+-------+                                     |           |
|         | IP whitelist                                |           |
|         v                                             v           |
|  checkInOutRouter                          StaffNotification      |
|  +--------------------------+             +------------------+   |
|  | checkIn <-- IP validate  |             | shift_pending_   |   |
|  | checkOut                 |             |   approval       |   |
|  | todayStatus              |             | shift_approved   |   |
|  | history                  |             | shift_rejected   |   |
|  | monthlyReport ---------+ |             +------------------+   |
|  | workdaysCount          | |                                    |
|  +------------------------+-+                                    |
|                            |                                      |
|         +------------------+----------------------+              |
|         v                  v                      v              |
|  KpiScore              Payslip            EmploymentProfile      |
|  (chuyen_can,          (workdays ref)     (position -> group)   |
|   di_muon)                                                       |
+------------------------------------------------------------------+
