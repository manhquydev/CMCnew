# 01 Auth, RBAC, RLS

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- `packages/auth/src/*`
- `packages/db/src/index.ts`
- Prisma schema and RLS migrations
- `apps/api/src/context.ts`, `trpc.ts`, `auth.ts`, `lms-auth.ts`, `guardian.ts`, `user.ts`, `audit.ts`
- Relevant auth/RLS tests

## Findings

### Medium: `staff_notification` RLS is facility-only, not recipient-aware

Evidence:

- `packages/db/prisma/migrations/20260626001219_rls_staff_notification/migration.sql:11`
- `apps/api/src/routers/staff-notif.ts:16`
- `apps/api/src/routers/staff-notif.ts:40`

Impact: route-level filters currently protect recipient isolation, but DB RLS allows same-facility staff access if a future query forgets `recipientId`.

Suggested fix: add staff user id to RLS context and require `recipient_id = app_user_id()` in policy, with super/system carve-outs.

### Medium: OTP dev fallback can expose login codes outside production

Evidence:

- `apps/api/src/services/login-otp.ts:48`
- `apps/api/src/routers/lms-auth.ts:67`

Impact: any reachable non-production environment with real parent accounts and Graph unconfigured can return passwordless login code in API response.

Suggested fix: gate `devCode` response/log behind explicit opt-in env such as `ALLOW_DEV_OTP_RESPONSE=true`.

## Verification Gaps

- No live pg_catalog introspection run.
- Integration tests not run due read-only review.

## Positive Controls

- Staff JWT resolves active user and token version from DB.
- Facility scope is resolved from DB, not trusted from JWT.
- LMS parent/student scope is resolved from guardian/student rows.
- `withRls` uses transaction-local GUCs and validates id shape.
- RLS denial mapping to `FORBIDDEN` exists for write-policy violations.

## Unresolved Questions

- Should staff inbox privacy be enforced at DB RLS level?
- Are staging/non-production environments externally reachable with real parent accounts?

