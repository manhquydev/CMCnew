# Work Shift Registration + Attendance System — Implementation Plan

**Status:** 🔨 Ready for implementation
**Created:** 2026-06-30
**Lane:** High-Risk
**Branch:** develop

## Architecture Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | ShiftGroup as DB table, not enum | Extensible without migration |
| 2 | Flat structure: ShiftRegistrationEntry per (reg, date, shift) | Simple queries, no JSONB |
| 3 | Punch system: earliest=IN, latest=OUT | User said so |
| 4 | Workflow: Draft→Submitted→Approved (2-step) | Manager approve only |
| 5 | Leave integrated: same form, type=work|leave | User said so |
| 6 | IP check advisory, not hard gate | Honest about web limitations |
| 7 | Manager via EmploymentProfile.managerId | Default to director by role |
| 8 | No ClassSession conflict check | GV tự quản |

## Files to Create/Modify

### NEW (10 files)
| File | Purpose |
|------|---------|
| `packages/db/prisma/migrations/*_work_shift/migration.sql` | DB migration |
| `apps/api/src/routers/shift-config.ts` | ShiftType CRUD |
| `apps/api/src/routers/shift-registration.ts` | Registration workflow |
| `apps/api/src/routers/check-in-out.ts` | Punch + IP validation |
| `apps/api/src/routers/facility-ip.ts` | IP whitelist CRUD |
| `packages/domain-attendance/src/punch.ts` | Pure functions: pairPunches, calcPenalty |
| `apps/admin/src/checkin-panel.tsx` | Check-in/out screen |
| `apps/admin/src/shift-reg-list-panel.tsx` | Registration list |
| `apps/admin/src/shift-reg-detail-panel.tsx` | Create/edit registration |
| `apps/admin/src/shift-reg-approval-panel.tsx` | Manager approval |

### MODIFY (6 files)
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | +6 models, +2 enums |
| `apps/api/src/routers/index.ts` | +4 router imports |
| `packages/auth/src/permissions.ts` | +4 module entries |
| `apps/admin/src/App.tsx` | +4 panel imports + routes |
| `apps/admin/src/shell.tsx` | +2 nav sections |
| `apps/admin/src/nav-permissions.ts` | +2 nav gates |

## Phases

### Phase 1: Data Model
- [ ] Add ShiftGroup, ShiftTemplate, ShiftRegistration, ShiftRegistrationEntry models
- [ ] Add TimePunch, FacilityNetwork models
- [ ] Add managerId to EmploymentProfile
- [ ] Run migration
- **Est:** 1-2 hours

### Phase 2: Backend API
- [ ] shiftConfig router (CRUD)
- [ ] shiftRegistration router (workflow: create, updateEntry, submit, approve, reject)
- [ ] checkInOut router (checkIP, punch, todayStatus, history)
- [ ] facilityIP router (CRUD)
- [ ] Permission registry entries
- [ ] Router registration in index.ts
- **Est:** 3-4 hours

### Phase 3: Domain Logic
- [ ] `packages/domain-attendance/src/punch.ts` — pairPunches, calcPenalty
- [ ] `packages/domain-attendance/src/ip-check.ts` — ipMatchesCidr
- **Est:** 1 hour

### Phase 4: Frontend UI
- [ ] Check-in/out panel (simple 2-button)
- [ ] Shift registration list (DataTable)
- [ ] Shift registration detail (shift grid with radio/checkbox)
- [ ] Manager approval panel
- [ ] Nav registration
- **Est:** 4-5 hours

### Phase 5: Integration & Polish
- [ ] StaffNotification events (shift_submitted, shift_approved, shift_rejected)
- [ ] Audit log via logEvent
- [ ] Permission parity test update
- **Est:** 2 hours
