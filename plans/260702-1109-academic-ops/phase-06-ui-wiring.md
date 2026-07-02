---
title: "P6 — UI wiring: room update/archive + meeting setSchedule + outcome note"
phase: 6
status: pending
risk: normal
owns: [apps/admin/src/class-workspace.tsx, apps/admin/src/meetings-panel.tsx]
---

# P6 — UI wiring

## Context
- Source: brainstorm §PLAN5.6. APIs exist, UI missing: `room.update`/`room.archive` (0 UI), `parentMeeting.setSchedule` (confirms TBD time parents already see), meeting outcome/note (schema has `note`, no UI to write it).
- Anchors (verified): `room.update` `room.ts:37`, `room.archive` `room.ts:61`; `parentMeeting.setSchedule` `parent-meeting.ts:50`; meeting `note` field in select `parent-meeting.ts:44`; only admin file referencing `room.` = `apps/admin/src/class-workspace.tsx`; meetings UI `apps/admin/src/meetings-panel.tsx`.

## Requirements
- Room edit + archive UI wired to `room.update`/`room.archive`. Host panel = `class-workspace.tsx` (sole current `room.` consumer) OR a dedicated rooms admin section — confirm host before building (see Open Qs).
- `parentMeeting.setSchedule` UI: staff confirms date/time → parents see confirmed time (they already read via `myMeetings`).
- Meeting outcome/note: writable field on meeting after it happens (`note` already in schema + select).

## Files
- Modify: `apps/admin/src/class-workspace.tsx` (room update/archive controls) — verify this is the right host.
- Modify: `apps/admin/src/meetings-panel.tsx` (setSchedule form + outcome note input).
- No API/schema change (mutations already exist) → **no migration**.

## Implementation steps
1. Room: add edit modal (name/capacity fields per `room.update` input) + archive action with confirm.
2. Meeting setSchedule: form (date/time/location) calling `parentMeeting.setSchedule`; on success show confirmed state.
3. Outcome note: textarea bound to meeting `note`, saved via existing mutation (verify a note-write mutation exists; if `setSchedule` doesn't carry note, confirm which mutation persists `note`).

## Tests / validation
- E2E: staff edits room → persists; archive hides from selectors.
- E2E: staff confirms meeting time → parent LMS `myMeetings` shows confirmed time.
- E2E: staff writes outcome note → persists + visible on reload.

## Risks / rollback
- Risk (low): pure UI wiring over existing audited mutations.
- Risk (med): note may lack a dedicated write mutation → verify before build; if missing, escalate (adds API scope).
- Rollback: revert UI; APIs untouched.

## Blockers
- Independent of P1–P5 files. Can run parallel. Only unknown: exact host panel for room UI + note-write mutation existence.
