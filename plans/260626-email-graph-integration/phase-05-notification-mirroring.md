# Phase 05 — Notification mirroring (email as a second channel)

**Goal:** Mirror selected in-app notifications to the parent's email. Start with the
parent-meeting reminder (already a cron job); make higher-volume types opt-in to avoid spam.

**Depends on:** Phase 01 + `parent-email.ts` helper from Phase 03. **Risk:** Low.

## Anchor points (from audit)

| In-app trigger | File:line | Email candidate | v1? |
|----------------|-----------|-----------------|-----|
| Parent-meeting reminder T-1 | `services/parent-meeting-reminder.ts:37–50` | `parent_meeting_email` | ✅ yes |
| Grade published | `routers/grade.ts:108` | digest | opt-in |
| Badge awarded | `routers/grade.ts:168`, `badge.ts:132` | digest | opt-in |
| Level-up approved | `routers/level-progress.ts:110` | `level_up_email` | opt-in |

## Work items

1. **parent-meeting-reminder.ts**: in the same txn that creates the in-app `notification` and stamps
   `remindedAt`, also `enqueueEmail` to the parent (`parentEmailForStudent`), `dedupKey =
   'pm_reminder:'+meetingId+':'+studentId`. The existing `remindedAt` guard already prevents
   re-sending, so email inherits idempotency for free.
2. **Preference flag (opt-in for noisy types):** add `ParentAccount.emailNotifications Boolean
   @default(true)` (or a small `email_preference` table if finer control is wanted — confirm with
   user). Grade/badge/level digests respect it; transactional emails (Phases 02–04) ignore it.
3. **Digest (optional, defer if lean):** a daily cron that batches the day's grade/badge events per
   parent into one `daily_digest` email instead of one-per-event. Recommended to avoid volume hitting
   the 30/min Exchange cap and annoying parents.
4. **Templates**: `parent_meeting_email`, `level_up_email`, `daily_digest`.

## Tests
- Reminder tick enqueues one email per active student's parent with email; re-tick sends none
  (`remindedAt` + `dedupKey`).
- A parent with `emailNotifications=false` gets transactional mail but not digest mail.
- No parent email → in-app notification still created, no email, no error.

## Risks / rollback
- Volume risk → mitigated by opt-in + digest + the Phase 01 rate limiter.
- Rollback: remove enqueue calls; in-app notifications untouched.
