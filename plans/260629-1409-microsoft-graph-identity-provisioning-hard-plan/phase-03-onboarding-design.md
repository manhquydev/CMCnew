# Phase 03 — Onboarding Design

## Context Links

- Existing user creation: `apps/api/src/routers/user.ts`
- AppUser model: `packages/db/prisma/schema.prisma`
- Existing secret-email scrub: `apps/api/src/services/email-outbox.ts`
- Microsoft docs: `POST /users`, `assignLicense`, `passwordProfile`, Temporary Access Pass docs
- Security critique: `../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`

## Overview

Design future onboarding as a durable job. Do not make Graph writes directly inside the user-create route response path.

## Requirements

- Idempotent per `AppUser` onboarding action.
- Step-state job: preflight → create user → assign license → deliver credential → mark complete.
- Temporary password or TAP value never stored durably.
- Existing `email_outbox.body_html` must not persist plaintext credential.
- Staff SSO remains source of login after first password/TAP onboarding.
- Local AppUser creation and Microsoft provisioning are separate permissions.

## Credential Delivery Decision

Must be decided in Phase 01 before implementation:

| Option | Security posture | Notes |
|---|---|---|
| Temporary Access Pass | Preferred if tenant policy/API supports it | Needs separate Graph API permission research and IT policy enablement. |
| Temporary password email | Higher leakage risk | Allowed only if no durable plaintext storage and force-change is enabled. |
| Manual IT onboarding | Lowest app permission risk | Keeps ERP out of credential delivery. |

## Future Data Model Candidates

Only after approval:

| Field/table | Purpose |
|---|---|
| `AppUser.entraUserId` | Store Microsoft Graph user `id`; unique when non-null. |
| `AppUser.entraUserPrincipalName` | Optional snapshot to verify destructive actions hit expected user. |
| `IdentityProvisioningJob` | Step state, status, attempts, next retry, redacted error. |
| Audit event | Actor, staff user, action, Graph object id, no secrets. |

## Mapping Invariants

- `entraUserId` must be unique when non-null.
- `entraUserId` changes require super_admin/IT repair action, reason, and audit.
- Destructive actions verify stored `entraUserId` plus expected UPN/email before execution.
- Two local AppUsers must never map to the same Entra user.

## Proposed Onboarding Flow

```text
[Admin creates local AppUser]
  -> [Explicit provisioning action by allowed IT/super_admin role]
  -> [Provisioning job queued]
  -> [Preflight: domain + SKU + permission/role evidence]
  -> [POST /users]
  -> [assignLicense]
  -> [Deliver TAP/temp credential without durable plaintext]
  -> [store entraUserId + completed]
```

## Important Design Choices

- Create separate `graph-identity-client`; do not extend email client.
- Use `forceChangePasswordNextSignIn: true` if temporary password path is chosen.
- Prefer `forceChangePasswordNextSignInWithMfa` only if Microsoft docs and tenant policy support the exact flow.
- Build username from verified email only; reject non-approved domain.
- Preflight license before create. If no license, do not create enabled user.
- Avoid `Directory.ReadWrite.All` unless later verified necessary.
- Do not let existing director `user.create` automatically trigger Microsoft tenant writes.

## Credential Storage Rule

Forbidden:

- Store temporary password/TAP in `IdentityProvisioningJob`.
- Store temporary password/TAP in `email_outbox.body_html`.
- Log temporary password/TAP in app logs, traces, errors, tests, screenshots.

Allowed patterns to evaluate:

- Synchronous send with no durable plaintext body.
- One-time display to IT/admin with explicit copy acknowledgement, no persistence.
- Microsoft-native TAP flow if available and approved.

## Graph Retry and Idempotency Rules

- Respect `Retry-After` for 429 when present.
- Do not blindly retry `POST /users`.
- After create uncertainty, verify by stored Graph response or lookup by expected UPN before retrying.
- License assignment retry must use stored `entraUserId` and desired SKU set.
- Every retry stores redacted error only.

## Tests or Validation

- Unit: request builders match Microsoft documented shapes.
- Unit: generated credential excluded from logs/errors/job rows.
- Unit: no credential is persisted in outbox body.
- Integration with mocked Graph:
  - success path all steps.
  - duplicate click does not create duplicate Graph user.
  - director local-create does not provision Microsoft user.
  - license unavailable blocks before create.
  - create succeeds, assign fails → retry resumes from assign step.
  - email/credential delivery fails → repair path does not expose stale credential.
  - 429 respects retry schedule.

## Risks and Rollback

Risk: user created but credential delivery fails, leaving unknown temp password/TAP.
Mitigation: choose TAP/manual flow if possible; otherwise synchronous no-store delivery plus audited reset/repair path.

Rollback: disable created Entra test user, revoke sessions, remove license, clear/repair `entraUserId` only through audited repair action.
