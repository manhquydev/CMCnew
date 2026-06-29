# Phase 02 — Cross-Entity Deep Links

## Context Links

- Plan: `plan.md`; depends on P1 Session Detail shell.
- `apps/admin/src/schedule-detail.tsx` — created in P1 (roster + class card host the new links).
- `apps/admin/src/class-workspace.tsx` — `EnrollTab` student rows (L478-496); `Workspace`/`NavAction` (L806-863).
- `apps/admin/src/student-detail.tsx` — `EnrollmentsTab` rows (L262-283); reachable via `StudentDetailPanel`.
- `apps/admin/src/students-panel.tsx` — `setDetailStudentId` opens Student Detail (L75-81, 201-210).
- `apps/admin/src/App.tsx` — section switch + `goToClass` (L714-825).
- `apps/admin/src/staff-profile.tsx` + plan `260629-2054` — staff record page (teacher link target); gated.
- `packages/auth/src/permissions.ts` — `user.viewActivity` (L232), staff visibility gates.

## Overview

Wire the missing record-to-record links so users follow relationships instead of re-searching: student↔class, schedule/session→student & class, and teacher→staff record (permission-gated). Reuse existing detail panels and `NavAction`; no new detail surfaces.

## Requirements

- Session Detail (P1): roster student row → Student Detail; class card → Class Detail (via `goToClass`).
- `ClassDetail` `EnrollTab`: student row → Student Detail.
- `StudentDetailPanel` `EnrollmentsTab`: class row → Class Detail (`goToClass(batchId,'sessions')`).
- Teacher chip (Session Detail / class schedule): → staff record page ONLY when the viewer is permitted (super_admin or roles in `user.viewActivity` / staff visibility). Otherwise render plain text, no link.
- Back navigation stays coherent (each detail keeps its existing back action).
- No permission downgrade: a link is shown only if its target is already viewable by the caller.

## Architecture / Approach

- Reuse `NavAction` for class jumps (already supported). For student jumps across sections, route through the existing `students` section detail state or lift a shared "open student detail" handler — prefer the lowest-effort path that does not add query-param routing.
- Teacher→staff link: gate with `can(roles,isSuperAdmin,'user','viewActivity')` (or the staff record page's own visibility helper from plan 260629-2054). Keep the gate in one helper to avoid drift.
- Do NOT introduce a global router; keep the app's hash-section + in-memory selection model.

## Implementation Steps (for the later build phase)

1. `gitnexus_impact` on `goToClass`, `StudentDetailPanel`, `NavAction`, and the staff record entry before editing.
2. Add student-row click handlers in Session Detail roster and `EnrollTab`.
3. Add class-row click in Student Detail `EnrollmentsTab` via `goToClass`.
4. Add permission-gated teacher chip link to the staff record page.
5. Verify back/forward between detail surfaces does not strand the user.

## Validation

- Admin typecheck clean.
- Manual/e2e: student row → student detail; class card/row → class detail; teacher chip → staff record only when permitted (negative case: unprivileged role sees text, no navigation, no fetch).
- Existing schedule/class/student flows unaffected.
- `gitnexus_detect_changes` shows only expected files.

## Risks and Rollback

- Risk: a teacher link leaking staff data to an unprivileged role. Mitigation: single gated helper + backend re-gates `staffTimeline`; link hidden when not permitted.
- Risk: navigation loops / lost back state. Mitigation: reuse existing back handlers; test round-trips.
- Rollback: revert link handlers; rows become non-interactive as before.
