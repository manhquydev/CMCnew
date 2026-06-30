---
title: "Hard Plan: Microsoft Graph ERP Identity Provisioning"
date: 2026-06-29
status: revised-after-security-critique
lane: high-risk
scope: plan-only-no-implementation
intake: 25
report: ../reports/hard-research-260629-1409-microsoft-graph-identity-provisioning-tenant-write-report.md
security_critique: ../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md
decision: ../../docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md
---

# Hard Plan: Microsoft Graph ERP Identity Provisioning

## Overview

Plan only. No source implementation. Goal is to define a safe, evidence-backed path for possible ERP automation of Microsoft Entra staff lifecycle:

- create Microsoft user through Graph,
- assign Microsoft 365 license,
- deliver temporary credential safely,
- deprovision staff safely.

Current default remains: staff ERP login uses Microsoft SSO, and staff Microsoft accounts are pre-created outside ERP.

## Revision Note

Updated after security critique report `plans/reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`.

Important distinction:

- **Microsoft fact:** app-only Graph permissions are powerful and may also require Microsoft Entra role assignment for sensitive actions.
- **CMCnew policy:** identity provisioning must use a separate Entra app registration to reduce blast radius. Microsoft does not require this separation; CMCnew does.

## Risk Classification

Lane: high-risk.

Risk flags:

- Auth.
- Authorization.
- Audit/security.
- External systems.
- Public contracts.
- Existing behavior.
- Weak proof until tenant sandbox verified.

Hard gates:

- Tenant identity writes.
- App-only Microsoft Graph permissions **and any required Microsoft Entra role assignment**.
- Temporary password / Temporary Access Pass decision.
- No durable plaintext credential storage.
- Deprovisioning and license removal.
- Sandbox or disposable non-admin test user before live write.

## Key Decision Before Any Code

Do we allow CMCnew ERP to write Microsoft tenant identities?

Recommended default: not yet. First approve this revised plan and create an ADR. If approved, implement only read-only diagnostic first.

## Source of Truth

| Source | Use |
|---|---|
| `docs/auth-sso-otp-redirection.md` | Existing staff SSO behavior; no JIT user creation. |
| `docs/decisions/0013-email-microsoft-graph-integration.md` | Existing Graph email decision; not identity write. |
| `apps/api/src/lib/graph-client.ts` | Current Graph email client pattern, but do not extend directly. |
| `apps/api/src/services/email-outbox.ts` | Durable email/outbox and current secret scrub pattern. |
| `apps/api/src/routers/user.ts` | Existing AppUser create/update/deactivate surface. |
| `packages/db/prisma/schema.prisma` | AppUser and EmailOutbox data model. |
| Microsoft Learn Graph docs | Endpoint and permission truth. |
| Security critique report | Plan gaps and required revisions. |

## Architecture Direction

Do not mix identity provisioning into existing `graph-client.ts`.

Planned future module boundary if implementation is approved:

- `graph-identity-client`: Microsoft Graph identity API client.
- `identity-provisioning`: durable orchestration service.
- DB job/audit records: step state, retries, redacted errors.
- Existing email outbox may send non-secret notifications; **do not persist plaintext temporary password/TAP in `email_outbox.body_html`**.

Reason: email Graph and identity Graph use different permissions, blast radius, operational controls, and audit requirements.

## Revised Security Invariants

| Invariant | Reason |
|---|---|
| Separate Entra app is CMCnew policy | Reduces blast radius if current SSO/email credential leaks. |
| Read-only diagnostic must have read-only consent only | An app with write consent is already dangerous even if code does not call write APIs. |
| Local AppUser create is separate from Microsoft provisioning | Directors can create local users today; tenant-write should require explicit stronger permission. |
| `entraUserId` must be unique and repair-only | Prevents deprovisioning the wrong Microsoft user. |
| No durable plaintext credential storage | Queue/database compromise must not expose onboarding secret. |
| Offboarding MVP is access cutoff + license recovery only | Full Microsoft 365 data retention/group/device cleanup stays IT-owned until separately researched. |
| Graph retries are operation-specific | Blind retry of `POST /users` can duplicate or mis-map identities. |

## Phases

| Phase | File | Status | Purpose |
|---|---|---|---|
| 01 | `phase-01-evidence-and-decision-gates.md` | revised | Lock official facts, ADR, tenant prerequisites, TAP decision, role gates. |
| 02 | `phase-02-read-only-graph-diagnostic.md` | revised | Validate separate read-only app and license inventory without write consent. |
| 03 | `phase-03-onboarding-design.md` | revised | Design create-user + license + safe credential delivery job. |
| 04 | `phase-04-deprovision-design.md` | revised | Design disable/revoke/remove-license offboarding with scoped non-goals. |
| 05 | `phase-05-validation-and-go-live-gates.md` | revised | Define test, sandbox, rollback, permission evidence, and live gates. |

## Dependencies

- Human approval of tenant-write risk.
- IT confirmation of app registration policy.
- Microsoft tenant admin able to grant application permissions.
- Verification of required Microsoft Entra role assignments for sensitive app-only actions.
- Staff license SKU mapping by role.
- Decision: Temporary Access Pass vs temporary password email vs manual IT onboarding.
- Offboarding retention policy.
- Sandbox or disposable non-admin test user process.

## Success Criteria

This plan is ready when:

- All Graph facts are linked to official docs.
- No implementation starts before approval.
- Plan separates email Graph from identity Graph.
- License and deprovision risks have explicit gates.
- Temporary credential handling has no durable plaintext persistence path.
- Validation path covers partial failure, Graph throttling, idempotency, and rollback.
- Read-only diagnostic cannot run with write permissions accidentally granted.
- Local AppUser create does not automatically become Microsoft tenant-write.

## Stop Conditions

Pause and return to user if:

- CMC rejects ERP tenant-write permission.
- IT cannot create a separate Entra app.
- Required permission must escalate to `Directory.ReadWrite.All` without clear reason.
- Required Microsoft Entra role assignment is unclear or too broad.
- No sandbox/test user can be used.
- Any plan requires storing plaintext passwords/TAP values durably.
- Temporary Access Pass feasibility is not decided before onboarding design.

## Unresolved Questions

1. Approve or reject ERP as Microsoft tenant identity writer?
2. Which SKU per staff role?
3. Use Temporary Access Pass, temporary password email, or manual IT onboarding?
4. Offboarding retention/delete policy?
5. Separate app credential: certificate or short-lived secret?
6. Who owns Microsoft-side app consent and Entra role assignment review?
7. Can director-created local users ever trigger Microsoft provisioning, or only super_admin/IT?
