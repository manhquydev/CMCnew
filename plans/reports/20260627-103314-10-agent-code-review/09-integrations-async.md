# 09 Integrations and Async

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- Microsoft Graph email
- email outbox
- OTP
- SSO
- Callio
- staff/LMS notifications and SSE
- PDF storage
- relevant tests

## Findings

### High: OTP request can succeed even when email was never sent

Evidence:

- creates OTP row: `apps/api/src/services/login-otp.ts:39`
- fire-and-forget send: `apps/api/src/services/login-otp.ts:51`
- route returns ok: `apps/api/src/routers/lms-auth.ts:72`
- verify picks newest OTP: `apps/api/src/services/login-otp.ts:70`

Impact: transient Graph failure can create a newest code that parent never receives, invalidating older delivered codes.

### High: Email outbox claiming is not DB-safe across API replicas

Evidence:

- `findMany` then `updateMany`: `apps/api/src/services/email-outbox.ts:122`
- single-instance comment: `apps/api/src/services/email-outbox.ts:86`
- cron embedded in every API process: `apps/api/src/index.ts:316`

Impact: multiple API replicas can select/send same queued email.

### Medium: Callio transient failures have no retry/backoff

Evidence:

- throws on any non-OK: `apps/api/src/lib/callio-client.ts:63`
- payroll sync no catch/retry: `apps/api/src/routers/payroll.ts:1173`

Impact: one 429/5xx fails full sync with no accounting/retry delay.

### Medium: Email audit logs include recipient email and provider detail

Evidence:

- success audit body: `apps/api/src/services/email-outbox.ts:160`
- failure audit body: `apps/api/src/services/email-outbox.ts:197`
- Graph error detail: `apps/api/src/lib/graph-client.ts:149`

Impact: audit/history retains PII and provider snippets; may need intentional policy.

### Medium: Staff notification RLS is facility-only

Evidence:

- policy: `packages/db/prisma/migrations/20260626001219_rls_staff_notification/migration.sql:11`
- route filters: `apps/api/src/routers/staff-notif.ts:16`

Impact: future same-facility query without recipient filter can leak notifications.

## Verification Gaps

- No test for Graph-configured OTP send failure after row creation.
- No multi-worker outbox claim test.
- No Callio 429/5xx/timeout retry test.
- No PDF upload/download route auth test observed.
- No cross-replica SSE delivery/backfill test.

## Positive Controls

- OTP codes are hashed, short-lived, single-use, attempt-capped.
- Unknown OTP email avoids enumeration.
- Outbox has dedup key, rate cap, 429 reschedule, terminal failure tests.
- PDF refs are SHA-256 hex before path join and route checks RLS before disk existence.
- SSE revalidates session on heartbeat.
- Email template fields are escaped.

## Unresolved Questions

- Will production run more than one API replica?
- Should staff notification confidentiality be DB-enforced?
- Are email addresses allowed in audit logs?
- Are Callio extensions globally unique across facilities?

