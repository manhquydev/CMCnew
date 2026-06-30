# Phase U3 — Secure Staff/Facility Activity Log

## Context Links

- Plan: `plan.md`; depends on U1 shell.
- `apps/api/src/routers/audit.ts` — `NOTE_TARGETS` whitelist EXCLUDES `user`/`facility` for RLS security (comment ~L32-37). MUST NOT widen this.
- `packages/audit/src/index.ts` — `getTimeline(tx, entityType, entityId)` filters by entity, NOT facility.
- `packages/db/prisma/schema.prisma` — `RecordEvent` has `facilityId?`, `entityType`, `entityId` (~L369-382). User/course events have `facility_id IS NULL`.
- `packages/ui/src/chatter.tsx` — open timeline UI; do NOT reuse for user/facility.

## Overview

Give the Staff Profile a "Nhật ký" tab WITHOUT opening the existing Chatter security hole. Build a separate, facility-scoped, permission-gated read path for `user`/`facility` events.

## The Security Problem (why a new path)

`record_event` rows for user/course management have `facility_id IS NULL` and are readable by any staff under RLS. The open `audit.timeline` deliberately whitelists only entities with a Chatter surface. Adding `user`/`facility` there would let any staff read anyone's role/activation history. So U3 needs its own gated endpoint with an explicit viewer check.

## Requirements

- New endpoint, e.g. `audit.staffTimeline({ userId })` and/or `audit.facilityTimeline({ facilityId })`:
  - Permission gate (super_admin + hr + relevant facility director — CONFIRM in plan.md OPEN QUESTION).
  - Explicit visibility pre-check: caller may view the target staff/facility (reuse the same scope as `user.list` / facility visibility), NOT a blanket read.
  - Returns only that target's events (`entityType='user'`/`'facility'`, `entityId=target`), newest first.
  - Read-only: NO note posting for user/facility in this phase (avoids the `postNote` facility-resolution issue that NOTE_TARGETS guards).
- New UI component (e.g. `StaffActivityLog`) rendered in the "Nhật ký" tab — a read-only timeline, NOT the editable Chatter.
- Leave `NOTE_TARGETS` and open Chatter UNCHANGED.

## Files To Modify/Create (proposed)

- Modify `apps/api/src/routers/audit.ts` — add `staffTimeline`/`facilityTimeline` with gate + visibility pre-check (do NOT touch NOTE_TARGETS).
- Modify `packages/audit/src/index.ts` — add a query helper that filters by entity (and optionally asserts the target), reused by the new endpoint.
- Modify `packages/auth/src/permissions.ts` — register the new audit read gate.
- Create `apps/admin/src/staff-activity-log.tsx` (or render inside `staff-profile.tsx`) — read-only timeline UI.

## Validation

- Unit: endpoint returns only target's events; rejects callers without permission; rejects cross-facility viewers.
- Security test: a staff role with no staff-admin permission CANNOT read another user's role/activation history (the exact leak the whitelist prevents).
- Integration: timeline shows real `logEvent` rows from user.setRoles/setActive/facility.update.
- Confirm open `audit.timeline` / `NOTE_TARGETS` behavior is byte-for-byte unchanged.

## Risks and Rollback

Risk: re-introducing the leak by querying user events without a per-target visibility check.
Mitigation: mandatory visibility pre-check + permission gate; read-only; no NOTE_TARGETS change.
Rollback: remove the new endpoint + tab; staff log simply not shown (current behavior).
