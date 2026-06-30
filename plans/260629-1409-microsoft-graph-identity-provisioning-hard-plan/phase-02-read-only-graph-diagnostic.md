# Phase 02 — Read-Only Graph Diagnostic

## Context Links

- Plan: `plan.md`
- Microsoft docs: `GET /subscribedSkus`
- Current email client: `apps/api/src/lib/graph-client.ts`
- Security critique: `../reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`

## Overview

Validate the separate identity-provisioner app without writing tenant identities. This is the safe first implementation phase if user approves later.

## Requirements

- Separate config from email/SSO Graph variables.
- No `POST /users`, no `PATCH /users`, no `assignLicense` writes.
- Only token acquisition and `GET /subscribedSkus`.
- The diagnostic app must have **read-only consent only**.
- Redact all token/config values in logs.

## Future Files To Modify/Create

Only after approval:

- `apps/api/src/lib/graph-identity-client.ts`
- `apps/api/test/graph-identity-client.test.ts`
- Optional admin-only diagnostic route, gated to `super_admin`.

## Proposed Config Names

Use separate names, not current `ENTRA_*`/`GRAPH_*` email config:

- `GRAPH_IDENTITY_TENANT_ID`
- `GRAPH_IDENTITY_CLIENT_ID`
- `GRAPH_IDENTITY_CLIENT_SECRET` or certificate equivalent
- `GRAPH_IDENTITY_ALLOWED_DOMAIN`
- `GRAPH_IDENTITY_DEFAULT_SKU_PART_NUMBER`

## Permission Evidence Gate

Before running diagnostic:

1. Capture redacted identity app permission list.
2. Confirm the app has `LicenseAssignment.Read.All` only for license inventory.
3. Fail the diagnostic if the app already has write roles such as:
   - `User.ReadWrite.All`
   - `Directory.ReadWrite.All`
   - `LicenseAssignment.ReadWrite.All`
   - `User.EnableDisableAccount.All`
   - `User.RevokeSessions.All`
4. If write consent is already granted, stop and ask whether to create a clean read-only app or continue with risk accepted.

## Implementation Steps

No source implementation now.

If approved later:

1. Add config loader returning `null` when incomplete.
2. Add token acquisition using `https://graph.microsoft.com/.default`.
3. Add `listSubscribedSkus()`.
4. Parse response into narrow internal type: `skuId`, `skuPartNumber`, `capabilityStatus`, `consumedUnits`, `prepaidUnits.enabled`.
5. Add unit tests with mocked fetch.

## Tests or Validation

- Unit: missing config returns disabled/no-op state.
- Unit: token never printed.
- Unit: SKU response parser rejects malformed shape.
- Manual/sandbox: can list SKUs with read-only app permission.
- Evidence: redacted permission list proves no write roles at diagnostic phase.

## Risks and Rollback

Risk: diagnostic accidentally gets write permissions.
Rollback: remove consent/app registration; no app data changed because phase is read-only.
