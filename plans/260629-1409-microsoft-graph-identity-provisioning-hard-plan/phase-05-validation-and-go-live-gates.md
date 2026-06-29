# Phase 05 — Validation and Go-Live Gates

## Context Links

- Harness matrix: `scripts/bin/harness-cli.exe query matrix`
- Test docs: `docs/TEST_MATRIX.md`
- Trace spec: `docs/TRACE_SPEC.md` if final implementation happens.
- Security critique: `../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`

## Overview

Define proof before writing code. Because this touches tenant identity, local tests are not enough; sandbox/live-smoke proof is required before production enablement.

## Test Plan

| Layer | Required cases |
|---|---|
| Unit | request builders, config loader, response parsers, redaction, permission-shape guards. |
| Integration | durable job step resume, partial failures, idempotency, audit, 429/retry handling. |
| E2E | admin flow only after Graph client mocked or sandbox available. |
| Platform | sandbox tenant/test user smoke for create/license/disable/revoke/remove. |
| Security | no plaintext password/TAP in DB/log/trace/outbox; permissions and Entra roles reviewed. |
| Audit | every provisioning/deprovision step has actor/action/result and redacted error. |

## Go-Live Gates

1. ADR accepted.
2. Separate Entra app created as CMCnew policy.
3. Read-only diagnostic completed with read-only consent only.
4. Write app consent granted only to approved permission set.
5. Required Microsoft Entra role assignments verified and documented.
6. Credential-delivery decision completed: TAP, temp password no-store delivery, or manual IT onboarding.
7. Secret/certificate stored in deployment secret manager, not repo.
8. Sandbox smoke test complete on disposable non-admin user.
9. Rollback runbook tested on disposable user.
10. Feature flag disabled by default in production.
11. First production run manually supervised by ERP operator + Microsoft tenant owner.

## Required Evidence

- Redacted Azure app permission list for read-only diagnostic.
- Redacted Azure app permission and Entra role list for write app before write phase.
- Test output for unit/integration suite.
- Redacted Graph sandbox smoke log.
- Proof no plaintext credential exists in DB/log/trace/outbox.
- Harness trace with files changed, commands, outcomes.
- No secret values in report or trace.

## Sandbox Smoke Checklist

Use a disposable non-admin test user only:

1. Create local AppUser without auto-provisioning.
2. Trigger explicit provisioning action.
3. Confirm Entra user created with expected UPN/domain.
4. Confirm selected SKU assigned.
5. Confirm credential delivery path works without durable plaintext storage.
6. Disable test user.
7. Revoke sessions and note Microsoft-documented delay.
8. Remove configured license.
9. Confirm rollback/re-enable path on test user if required.

## Rollback Runbook

For a test/prod-created user:

1. Disable account.
2. Revoke sessions.
3. Remove CMC-managed licenses.
4. Mark local job failed/reverted with audit reason.
5. Re-enable/reassign only through audited repair action.
6. Keep delete manual unless retention policy says otherwise.

## Manual IT Handoff

ERP automation MVP does not prove full Microsoft 365 offboarding. IT still owns:

- mailbox retention/legal hold,
- OneDrive/SharePoint ownership transfer,
- Teams/group cleanup,
- device/Intune cleanup,
- forwarding/delegation decisions,
- permanent deletion timing.

## Unresolved Questions Before Implementation

1. Will production allow live user creation from ERP, or only sandbox first?
2. What is the exact license SKU and disabled service plans if any?
3. TAP, temp password no-store delivery, or manual onboarding?
4. Who owns Microsoft-side break-glass if app permission or token breaks?
5. Which Microsoft 365 offboarding tasks remain manual vs future automation?
