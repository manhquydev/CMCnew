# Deep Re-Audit: Audit/Log + Data Claims

**Project:** CMCnew (Windows, develop branch, React+tRPC monorepo)  
**Scope:** Verify 8 core claims on audit/log structure, permissions, data model, and API endpoints  
**Date:** 2026-06-29  
**Method:** Read-only code analysis (no modifications)

---

## Executive Summary

All 8 claims **VERIFIED** with exact file:line evidence. 

Key findings:
- `staffTimeline` procedure is fully implemented, gated by `requirePermission('user', 'viewActivity')`, and wired in staff-profile.tsx UI (lines 200–201).
- Per-target facility visibility gate is correct: non-super callers must share at least one facility with the target staff.
- No existing API endpoint combines session detail with roster/attendance; `attendance.listBySession` and `schedule` endpoints remain separate.
- RecordEvent and ClassSession schemas support session-detail reads via existing relations (no schema change required).

---

## Per-Claim Verdict Table

| # | Claim | Verdict | Evidence: File:Lines |
|---|-------|---------|-----|
| 1 | NOTE_TARGETS whitelist includes receipt, opportunity, class_batch, student, after_sale_case; EXCLUDES user and facility. Security comment explains facility_id IS NULL for user/course events. | **VERIFIED** | `apps/api/src/routers/audit.ts:12–24` — NOTE_TARGETS dict lists exactly 5 entries (receipt, opportunity, class_batch, student, after_sale_case). Comment lines 9–11: "Một ghi chú chỉ được gắn vào record có Chatter + có cơ sở. facilityId LẤY TỪ chính record (qua RLS) — không bao giờ tin client gửi lên..." explains facility_id safety and why client input is ignored. |
| 2 | `staffTimeline` procedure DEFINED (NEW); gated by `requirePermission('user', 'viewActivity')`; per-target facility visibility pre-check (shared facility); exact behavior & line numbers. NO `facilityTimeline` endpoint exists. | **VERIFIED** | `apps/api/src/routers/audit.ts:136–150`. Procedure definition line 136: `staffTimeline: requirePermission('user', 'viewActivity')`. Input line 137: `z.object({ userId: z.string().uuid() })`. Gate logic lines 140–146: non-super must find shared facility via `userFacility.findFirst({ where: { userId: input.userId, facilityId: { in: ctx.session.facilityIds } }, select: { userId: true } })`. Returns `getTimeline(tx, 'user', input.userId)` (line 148). **NO `facilityTimeline` endpoint found.** |
| 3 | `user.viewActivity` action exists in PERMISSIONS registry. Roles: hr, giam_doc_kinh_doanh, giam_doc_dao_tao. Quote the registry entry. | **VERIFIED** | `packages/auth/src/permissions.ts:232` — exact entry: `viewActivity: ['hr', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao']` |
| 4 | `getTimeline(tx, entityType, entityId)` filters by entityType+entityId only, newest-first. NO facility filter in helper itself. Facility filtering is caller's responsibility. | **VERIFIED** | `packages/audit/src/index.ts:94–111`. Function signature lines 94–97. WHERE clause line 100: `{ entityType, entityId }` only. `orderBy: { createdAt: 'desc' }` (line 101) = newest-first. No facility filter in the helper; filtering enforced at **caller layer** (audit.timeline / audit.staffTimeline procedures). |
| 5 | RecordEvent schema: facilityId (nullable), entityType, entityId, type, changes, body, actorId, indexes [entityType,entityId] and [facilityId]. ClassSession: facilityId, classBatchId, batch relation, sessionDate, startTime, endTime, roomId, teacherId, status, attendances. Enrollment links student+batch with status. Schema supports session-detail view via existing relations (no schema change needed). | **VERIFIED** | RecordEvent (lines 369–382): facilityId nullable (line 371), entityType/entityId (lines 372–373), type/changes/body/actorId (lines 374–377), indexes [entityType,entityId] and [facilityId] (lines 380–381). ClassSession (lines 286–308): all required fields present; attendances relation (line 302). Enrollment (lines 311–333): all required fields. Existing relations (batch, room, attendances via Enrollment) support session detail reads without schema changes. |
| 6 | `mySessions` returns sessions with batch {id,code,name} include and resolves roomName. Does NOT return enrolled students or attendance for a session. `listSessions(classBatchId)` returns sessions for a batch. | **VERIFIED** | `apps/api/src/routers/schedule.ts:84–130` (mySessions). Line 111: `include: { batch: { select: { id: true, code: true, name: true } } }`. Lines 118–123: secondary roomName resolution query. NO attendance or enrollment includes. `listSessions` (lines 71–80): simple findMany by classBatchId, no includes. |
| 7 | NO existing API endpoint returns single class session WITH roster/attendance (session detail query). Confirm explicitly. | **VERIFIED** | `attendance.listBySession` (attendance.ts:9–15) returns only `tx.attendance.findMany({ classSessionId })` — no session metadata, no enrollment/student joins. `schedule.mySessions` and `schedule.listSessions` include batch metadata but NOT attendances or enrollments. **Confirmed: NO endpoint combines session + roster.** |
| 8 | `apps/admin/src/staff-profile.tsx` already calls `trpc.audit.staffTimeline` (UI wiring exists). Note exact line numbers. | **VERIFIED** | `apps/admin/src/staff-profile.tsx:39` (type definition: `type TimelineEntry = Awaited<ReturnType<typeof trpc.audit.staffTimeline.query>>[number]`), **lines 200–201** (query call in `ActivityLog` function: `trpc.audit.staffTimeline.query({ userId })`). Full context: ActivityLog fn starts line 194, useEffect lines 198–205. |

---

## Supplementary Technical Notes

### staffTimeline Gate Mechanics
The permission check `requirePermission('user', 'viewActivity')` is enforced at middleware level; super_admin bypasses it. The per-target facility pre-check (lines 140–146) is an **additional gate** for non-super callers:
- Super admin: skips the facility check (line 140 condition).
- Non-super: must find at least one `UserFacility` row where `userId=input.userId` AND `facilityId ∈ caller.facilityIds`.
- Failure → `NOT_FOUND` error (line 145–146).

This pattern mirrors the `timeline` and `followers` procedures (lines 37–60): entity-level visibility pre-check prevents cross-facility escalation.

### Record Event Facility Scoping
Comment lines 9–11 in audit.ts correctly document the security invariant:
- Notes may only be attached to records with a Chatter surface (NOTE_TARGETS whitelist).
- `facility_id` is **read from the record itself** (server-authoritative), never from client input.
- RLS enforces facility scope on the lookup, preventing cross-tenant access.
- This prevents a staff member at facility B from injecting notes (or follower records) into facility A's records.

### Session Detail Gap
Currently, no single API call returns ClassSession + Enrollment roster + Attendance marks. The schema supports it:
- ClassSession.attendances relation (via Enrollment→Attendance FK).
- Could be added as a new `schedule.sessionDetail(classSessionId)` query with:
  ```
  include: {
    batch: { select: { id, code, name } },
    attendances: { include: { enrollment: { include: { student: true } } } }
  }
  ```
- **No schema migration required** — all indexes and relations already exist.

---

## Status

**Status:** DONE

**Summary:** All 8 claims verified with exact file:line evidence. staffTimeline is fully implemented, gated by permission + facility pre-check, and wired in staff-profile.tsx (lines 200–201). No session-detail endpoint exists; schema supports future implementation without changes.

---

## Unresolved Questions

None. All claims resolved with concrete evidence.
