# Phase 03 — Session Activity Surface

## Context Links

- Plan: `plan.md`; depends on P1 Session Detail shell.
- `apps/api/src/routers/audit.ts` — `NOTE_TARGETS` whitelist (L12-24) covers `class_batch`/`student`; EXCLUDES `user`/`facility`; security comment (L32-39). `staffTimeline` is the separate secure staff channel — not touched here.
- `packages/ui/src/chatter.tsx` — reusable timeline + note UI (L34-131).
- `packages/audit/src/index.ts` — `getTimeline` (L93-111), `logEvent` (L39-54).
- `apps/api/src/routers/schedule.ts` — slot/session changes log to `class_batch` (L59-66, L222-229).

## Overview

Show activity/log inside Session Detail using ONLY existing safe channels. Sessions and slots already log to `class_batch`, so the class-level `Chatter` is the correct, already-whitelisted surface. This phase locks that choice and proves the existing audit security boundary is unchanged.

## Decision (from brainstorm log options)

- Adopt **L1 (class-level log)** for MVP: render `Chatter entityType="class_batch" entityId={batch.id}` in Session Detail.
- Do NOT add a `class_session` timeline or session notes this round (would need `NOTE_TARGETS` work + visibility design). Record as a future option only if users need session-specific separation.

## Requirements

- Session Detail shows the class activity log via existing `Chatter` (`class_batch`), reusing the same component already used in `ClassDetail` log tab.
- `audit.timeline` and `NOTE_TARGETS` remain byte-for-byte unchanged.
- No `user`/`facility` timeline is exposed anywhere through this phase.
- The secure staff timeline (`audit.staffTimeline`) is consumed only by the staff record page (plan 260629-2054), not duplicated here.

## Architecture / Approach

- Pure reuse: mount `<Chatter entityType="class_batch" entityId={batchId} />` in Session Detail.
- No backend change. No new endpoint. No permission registry change.

## Implementation Steps (for the later build phase)

1. Confirm `class_batch` is in `NOTE_TARGETS` (it is) — no edit.
2. Mount `Chatter` for the session's `batchId` in `schedule-detail.tsx`.
3. Add a test asserting `audit.timeline({entityType:'user',...})` still throws BAD_REQUEST (boundary unchanged).

## Validation

- Security test: `audit.timeline` for `user`/`facility` still rejected; `NOTE_TARGETS` unchanged.
- Manual: Session Detail shows class events/notes; posting a note works for permitted staff (same as today's class log).
- Admin typecheck clean; existing audit tests pass.
- `gitnexus_detect_changes` shows only the Session Detail UI file changed (no API/audit/permission files).

## Risks and Rollback

- Risk: scope creep into session-level notes or staff/user logs. Mitigation: explicit L1-only decision; stop condition in plan forbids widening `NOTE_TARGETS`.
- Rollback: remove the `Chatter` mount from Session Detail; log simply not shown there (still available in `ClassDetail` log tab).
