# Red-Team Review: teacher.cmcvn LMS bridge plan

Date: 2026-07-06.

## Accepted findings

1. SSO callback is single-origin today; teacher host login requires host-aware return origin/path and registered redirect URIs.
2. Direct intake can recreate existing transaction-abort bugs unless it reuses race-safe parent find-or-create/savepoint semantics.
3. Direct-created students/enrollments need first-class provenance or must stay as finance/provisioning drafts.
4. Current enrollment duplicate handling is check-then-create; concurrent duplicate submit needs deterministic conflict handling.
5. Teacher mutation authority is UI-only in key paths today; attendance, session evidence, and grading need server-side assigned-teacher guards.
6. Exercise publish notification is post-commit and not durable enough for launch claims.
7. Parent email success must verify delivery/drain state, not only queued outbox rows.
8. Current RBAC split prevents one director from completing the whole setup without either permission changes or a handoff decision.
9. Public-domain deployment needs Cloudflare/DNS/SSL preflight before Jenkins smoke.
10. Scope should stay as host bridge plus proven gaps; class day, exercise publishing, parent/student LMS flows already exist and should be smoke/fix-only unless a concrete gap is observed.
11. `devteacher.cmcvn.edu.vn` is not in the user request and should not block MVP unless explicitly accepted.
12. Exercise file route has an accepted broad-read-by-ref exception under decision 0022; plan must not overclaim PDF secrecy.
13. New audit/report artifacts must avoid raw parent phone/email in human-readable bodies.

## Rejected or narrowed findings

1. `exercise.publish` role split was narrowed. The cited `publish` key in `packages/auth/src/permissions.ts` is under `sessionEvidence`, not `exercise`; current exercise publish path goes through director-only `exercise.upsert`. The plan now says not to add a new exercise publish route without an explicit role matrix.

## Evidence highlights

- `apps/api/src/index.ts` SSO callback currently redirects via single `ADMIN_APP_ORIGIN`.
- `apps/api/src/routers/finance.ts` documents savepoint/race-safe parent provisioning.
- `packages/db/prisma/schema.prisma` has `createdByReceiptId` provenance for students/enrollments, but no direct-intake provenance.
- `packages/auth/src/permissions.ts` currently splits `classBatch.create` and `enrollment.enroll` across director roles.
- `apps/admin/src/attendance-roster.tsx` explicitly states some attendance assignment checks are only UI warnings today.
- `docs/codebase-summary.md` says `apps/admin` is already the unified staff shell and `apps/teaching` is retired.
- `apps/admin/src/course-exercise-manager.tsx` already provides curriculum exercise upload/publish behavior.

## Unresolved questions

- Should one director role be allowed to complete setup end-to-end, or should the launch require a KD/DT handoff?
- Should direct parent+student intake create real active students, or only draft/provisioning records until finance approval?
- Should `devteacher.cmcvn.edu.vn` be added now, or deferred as a separate infra story?
