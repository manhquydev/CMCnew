# Phase 01 — Evidence and Decision Gates

## Context Links

- Plan: `plan.md`
- Research: `../reports/hard-research-260629-1409-microsoft-graph-identity-provisioning-tenant-write-report.md`
- Security critique: `../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`
- Existing decision: `docs/decisions/0013-email-microsoft-graph-integration.md`
- Existing auth design: `docs/auth-sso-otp-redirection.md`

## Overview

Lock the technical truth before code. This phase prevents hallucinated Graph behavior and forces human approval before tenant-write work.

## Requirements

- Confirm official Microsoft docs for every Graph endpoint, permission, and any Entra role requirement.
- Create an ADR before implementation if CMC accepts ERP tenant-write capability.
- Confirm separate Entra app registration as **CMCnew security policy**, not Microsoft platform requirement.
- Confirm current SSO behavior remains fail-closed: AppUser must exist and be active.
- Decide onboarding credential method before Phase 03: Temporary Access Pass, temporary password email, or manual IT onboarding.

## Decision Gates

| Gate | Required answer |
|---|---|
| Tenant-write approval | Yes/no: may ERP create/disable Microsoft users? |
| App separation | CMCnew requires separate identity-provisioner app to reduce blast radius. |
| Permission + role proof | For every operation, list Graph application permission and any required Microsoft Entra role assignment. |
| Permission ceiling | Avoid `Directory.ReadWrite.All` unless a future verified operation proves it is required. |
| TAP vs temp password | Decide before onboarding design; do not leave as late unresolved question. |
| Password policy | No plaintext password/TAP durable persistence. |
| Sandbox | Must have disposable non-admin test user or sandbox tenant before live write. |
| Privileged account exclusion | Microsoft admin/privileged users are manual-only unless a later ADR explicitly approves. |

Amendment options (A tenant-write / B credential / C offboarding) are pre-drafted in
`docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md` → "Amendment Templates".
Each chosen axis unblocks exactly one downstream phase; B1 (TAP) requires verifying the
TAP create API + permission before it can be selected.

## Implementation Steps

No source implementation in this phase.

1. ADR drafted: `docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md` (status Proposed).
2. Review with user/IT.
3. Record accepted permissions, Entra roles, and non-goals.
4. Record credential-delivery decision: TAP, temp password email, or manual.
5. If rejected, stop plan; keep manual Entra provisioning.

## Tests or Validation

- ADR exists and is linked from the story/plan.
- Official Microsoft docs cited for each endpoint.
- Redacted Azure/Entra permission and role list attached to plan evidence before any write phase.
- No source files changed.

## Risks and Rollback

Risk: approving broad tenant-write by accident.
Rollback: reject ADR; keep current manual pre-provisioning + SSO.
