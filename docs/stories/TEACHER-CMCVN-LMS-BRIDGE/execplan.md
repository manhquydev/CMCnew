# Exec Plan

## Goal

Ship a supported `teacher.cmcvn.edu.vn` staff-domain bridge for teacher/director LMS operations, then prove teacher, parent, and student flows on the shared ERP/LMS stack.

## Scope

In scope:

- Explicit production teacher vhost.
- Host-aware staff login return without broad cookie domain.
- Cloudflare/DNS/SSL preflight.
- Director intake handoff that preserves provisioning invariants.
- Teacher assigned-session mutation guards where missing.
- Smoke/fix existing exercise, class day, parent, and student flows.
- Docs, journal, handoff, and production deploy evidence.

Out of scope:

- New standalone teacher app.
- `devteacher` unless explicitly accepted.
- Direct active-student intake unless a new accepted decision exists.
- Redesign of existing class day/exercise/LMS UI without concrete blocker.

## Risk Classification

Risk flags:

- Auth/Authz.
- Public domain and cookies.
- Student/parent identity.
- RLS-visible data.
- External email.
- Production deployment.

Hard gates:

- No implementation of direct active-student intake without accepted decision.
- No broad cookie domain.
- No teacher mutation claims until server-side ownership tests exist.
- No production launch without teacher-domain smoke.

## Work Phases

1. Final validation decisions.
2. Teacher host/SSO/domain.
3. Director intake handoff and role choreography.
4. Smoke/fix exercise publishing.
5. Teacher server ownership guards and class day smoke.
6. Parent/student validation.
7. Deploy/docs/journal/handoff.

## Stop Conditions

Pause for human confirmation if:

- User insists on direct active-student creation.
- User wants both directors to own every setup action.
- User wants `devteacher` in MVP.
- Any migration or data cleanup is required.
