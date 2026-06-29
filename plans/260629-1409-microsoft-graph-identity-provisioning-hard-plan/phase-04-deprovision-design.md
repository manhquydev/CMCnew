# Phase 04 — Deprovision Design

## Context Links

- Current staff deactivate path: `apps/api/src/routers/user.ts`
- Microsoft docs: update user, revoke sign-in sessions, assignLicense remove licenses, delete user
- Security critique: `../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`

## Overview

Design offboarding separately from onboarding. Deprovision affects access and license cost, so it needs explicit confirmation and reversible stages.

## Requirements

- ERP `AppUser.isActive=false` remains local app access shutoff.
- Microsoft account action is separate durable job.
- Default offboarding MVP: disable account, revoke sessions, remove license.
- Delete user is out of MVP unless user approves retention policy in a later ADR.
- Privileged Entra/admin accounts are manual-only unless a later ADR explicitly approves automation.
- Microsoft 365 data-retention offboarding remains IT-owned unless separately researched.

## Scope Boundary

In scope for MVP deprovision design:

- Stop ERP access.
- Disable Microsoft user.
- Revoke sign-in sessions.
- Remove configured licenses.
- Audit all actions.

Out of scope for MVP:

- Mailbox retention / litigation hold.
- OneDrive/SharePoint ownership transfer.
- Teams/group membership cleanup.
- Device management / Intune cleanup.
- Email forwarding/delegation decisions.
- Permanent user deletion.

## Proposed Deprovision Flow

```text
[Super admin/IT deactivates AppUser]
  -> [Provisioning job queued]
  -> [Verify entraUserId + expected UPN/email]
  -> [PATCH /users/{id}: accountEnabled=false]
  -> [POST /users/{id}/revokeSignInSessions]
  -> [POST /users/{id}/assignLicense removeLicenses]
  -> [audit complete]
  -> [manual IT checklist for M365 data-retention tasks]
```

## Permission and Role Facts

| Step | Microsoft-documented permission | Extra gate |
|---|---|---|
| Disable account | `User.EnableDisableAccount.All` + `User.Read.All` for `accountEnabled` update. | Verify whether app also needs Entra role assignment for sensitive target. |
| Revoke sessions | `User.RevokeSessions.All`. | Expect small delay before sessions are revoked. |
| Remove license | `LicenseAssignment.ReadWrite.All`. | Use stored desired license state; no blind remove-all unless policy says so. |
| Delete user | `User.ReadWrite.All`, but out of MVP. | Deleting privileged users can need higher role; manual-only by default. |

## Graph Retry and Idempotency Rules

- Respect `Retry-After` for 429 when present.
- Retrying disable is safe only after verifying target `entraUserId` and expected UPN/email.
- Retrying revoke sessions is acceptable, but must log that session revocation may take minutes.
- Retrying license removal must target only configured CMC-managed SKUs.
- Failed step resumes from last incomplete step; never restart by creating/deleting a user.

## Tests or Validation

- Unit: disabled-user patch body is exactly `{ accountEnabled: false }`.
- Unit: revoke sessions has no request body.
- Unit: remove license passes empty `addLicenses` and configured `removeLicenses`.
- Unit: privileged/missing/ambiguous `entraUserId` blocks automation.
- Integration mocked Graph:
  - local deactivate succeeds, Graph job pending.
  - retry resumes after disable if revoke fails.
  - no delete call in MVP.
  - missing `entraUserId` creates manual task, not Graph call.
  - only configured CMC-managed SKU is removed.

## Risks and Rollback

Risk: accidental deactivation of wrong Microsoft user.
Mitigation: require stored unique `entraUserId`, matching UPN/email check, confirmation UI for high-risk roles, manual-only privileged accounts.

Rollback: re-enable account and reassign license manually or via audited repair job.
