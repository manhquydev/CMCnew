---
title: "LMS engagement + rewards admin: open-notif + gift/star/badge mgmt + parent self-service"
description: "Notify students when new exercises open; add gift/star/redeem + badge admin UIs; parent profile edit + staff-approved child-link (anti-takeover); polish meeting-reminder notif label."
status: pending
priority: P2
effort: ~4d
branch: develop
tags: [lms, notifications, rewards, badges, parent]
created: 2026-07-02
---

# LMS engagement + rewards admin

Close 5 engagement/admin gaps (brainstorm PLAN 6, operator-approved 2026-07-02). Turns dormant reward/badge APIs into operable surfaces and closes the parent + student notification loop.

## Dependencies (hard blockers)

- **AFTER Plan 1 `260702-0929-lms-erp-seam-fixes`** — depends on exercise shape: global `Exercise` keyed by `curriculumUnitId`, query-time auto-open via `openedUnitIdsFor(tx, studentIds)` (`apps/api/src/lib/exercise-open.ts:28`), `sessionHasEnded` (:24). **Assumption:** these two helpers + `Exercise.status='published'`/`archivedAt` filter survive seam-fixes. Re-grep at implementation; scout summaries go stale.
- **AFTER Plan 2 `260702-1007-lms-homework-pdf-completion`** — file overlap: Plan 2 P2 owns `apps/lms/src/parent-view.tsx`, Plan 2 P1 owns `apps/lms/src/student-view.tsx`. This plan's P1 (label) + P4 (parent UI) touch `parent-view.tsx` → serialize after Plan 2 merges.

## Intake lane: NORMAL with strong validation

Flags: Authorization (star-adjust director-gate, parent self-link), Data model (additive: `RewardStatus.delivered` value + new `GuardianLinkRequest` table), Audit (star adjust audited), Existing behavior (redeem terminal state extended). Authorization is normally a hard gate → high-risk. **Justification for normal-strong** (per docs/FEATURE_INTAKE.md, operator narrowed scope 2026-07-02): all authorization deltas are least-privilege and anti-escalation — parent CANNOT self-link (staff approves every link, blocking account-takeover); manual star adjust is director-gated + fully audited; no auth/session/login change; migrations additive-only (no data loss, no column drop). Validation: unit + integration + manual per phase; RLS integration tests mandatory for P4.

## Phases

| # | Phase | Depends | File ownership (exclusive) | Status |
|---|-------|---------|----------------------------|--------|
| P1 | New-exercise-open student notification (2 triggers) | Plan 1 | services/exercise-open-notify.ts (new), lib/exercise-open.ts (inverse helper), routers/exercise.ts (upsert Trigger A), index.ts (cron reg), parent-view.tsx (label) | pending |
| P2 | Gift/star/redeem admin | Plan 1 | routers/rewards.ts, domain-rewards/stars.ts, rewards-panel.tsx, schema (enum value) | pending |
| P3 | Badge admin UI | none | apps/admin/src/badge-panel.tsx (new), admin nav | pending |
| P4 | Parent self-service (profile + link request) | Plan 2 | routers/guardian.ts, schema (new model), guardians-panel.tsx, apps/lms parent UI | pending |
| P5 | Validation | P1-P4 | *.int.test.ts (new), manual checklist | pending |

Parallelizable: P3 fully independent (no shared files, API complete). P2 independent of P1. P1 + P4 both touch `parent-view.tsx` → P1 label edit is a tiny disjoint region (notif switch `:225`) from P4's parent UI, but same file → serialize P1 before P4 or coordinate single owner. P5 last.

## Acceptance (measurable)

- Student gets ONE `new_exercise_open` notification per (studentId, exerciseId) whenever the exercise becomes visible, via EITHER trigger: (A) `exercise.upsert` publishes an exercise whose unit already had a session end, or (B) cron detects a session end for a unit that already has a published exercise. Idempotency keyed on (studentId, exerciseId) — re-ticks, both-triggers, and editSlot session moves create zero duplicates (integration tests). Fires iff the exercise is visible per `openedUnitIdsFor`.
- `parent-view.tsx` label switch renders friendly text for `new_exercise_open` AND `parent_meeting_reminder` (no more "Thông báo mới" fallback for these two).
- Director can update gift (name/stars/stock/image), archive gift, adjust stock; changes audited. Manual star adjust (+/- with reason) is director-gated, writes a `manual` StarTransaction, audited; balance reflects it.
- Redeem lifecycle extends approved → delivered; staff marks delivered; delivered is terminal (integration test rejects re-transition).
- Badge admin panel: director lists (incl archived), creates (criteria form), archives; teacher+director grant to a student. Grant re-fire on owned badge = no-op (already guaranteed `badge.ts:125`).
- Parent edits own profile (displayName/email/phone) — scoped to `ctx.lms.accountId`, `kind==='parent'` only. Parent submits link-request by phone/student-code → creates `pending` GuardianLinkRequest; staff queue approve → creates guardian link; reject → closed. Parent NEVER links directly (anti-takeover integration test: parent cannot create a guardian row).

## Phase files

- [phase-01-open-notification-cron.md](phase-01-open-notification-cron.md)
- [phase-02-gift-star-redeem-admin.md](phase-02-gift-star-redeem-admin.md)
- [phase-03-badge-admin-ui.md](phase-03-badge-admin-ui.md)
- [phase-04-parent-self-service.md](phase-04-parent-self-service.md)
- [phase-05-validation.md](phase-05-validation.md)

Reports: `plans/260702-1109-lms-engagement-rewards-admin/reports/`

## DEBT (explicitly out of scope)

Facility leaderboard, seasonal star reset, student change-password.
