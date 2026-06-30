---
title: "Hard Research: Microsoft Graph Tenant-Write Identity Provisioning"
date: 2026-06-29
lane: high-risk
status: completed
scope: research-only-no-implementation
---

# Hard Research: Microsoft Graph Tenant-Write Identity Provisioning

## Summary

Research target: ERP-driven Microsoft Entra staff lifecycle: create user, assign Microsoft 365 license, generate temporary password, notify employee, and deprovision later.

Verdict: technically feasible, but security risk is materially higher than current CMCnew Graph email. Current CMCnew Graph use sends email through approved mailboxes. This proposal writes tenant identities and licenses. Treat as separate high-risk product/security decision.

Recommendation: do not implement yet. First approve a hard plan, create an ADR, and validate in sandbox tenant or test-only user scope.

## Verified Facts From Official Microsoft Docs

| Topic | Verified fact | Source |
|---|---|---|
| Create user | Microsoft Graph supports `POST /users`; required normal-user fields include `accountEnabled`, `displayName`, `mailNickname`, `userPrincipalName`, `passwordProfile`. | Microsoft Learn: Create user |
| Create user permission | Application permission listed from least to higher: `User.ReadWrite.All`, `Directory.ReadWrite.All`. | Microsoft Learn: Create user |
| License assign/remove | Microsoft Graph supports `POST /users/{id or userPrincipalName}/assignLicense`; body has `addLicenses` and required `removeLicenses` array, which may be empty. | Microsoft Learn: user assignLicense |
| License permission | Least privileged application permission for assign/remove is `LicenseAssignment.ReadWrite.All`. | Microsoft Learn: user assignLicense |
| SKU inventory | Microsoft Graph supports `GET /subscribedSkus`; least privileged application permission is `LicenseAssignment.Read.All`. | Microsoft Learn: subscribedSkus list |
| Disable account | User update supports `accountEnabled`; least privileged app combo for this property is `User.EnableDisableAccount.All` + `User.Read.All`. | Microsoft Learn: Update user |
| Password profile update | Updating `passwordProfile` has least privileged permission `User-PasswordProfile.ReadWrite.All`. | Microsoft Learn: Update user |
| App-only risk | App-only access is broader and more powerful than delegated access; app acts as itself and receives unconstrained access for granted app roles. | Microsoft Learn: app-only access primer |
| Admin consent | App-only permissions require admin consent; dynamic runtime consent is not supported for app-only access. | Microsoft Learn: app-only access primer |

## CMCnew Current State

| Area | Current fact | Evidence |
|---|---|---|
| Staff auth | ERP staff uses Microsoft Single Sign-On; AppUser must already exist and be active. No just-in-time creation. | `docs/auth-sso-otp-redirection.md` |
| Graph email | Current accepted decision is outbound email via Graph `sendMail` with outbox and no-op if env missing. | `docs/decisions/0013-email-microsoft-graph-integration.md` |
| Graph client | `apps/api/src/lib/graph-client.ts` is email-specific: config, token, sender mailbox, `sendViaGraph`. | local code |
| Secret-bearing emails | `email-outbox.ts` scrubs `otp_login` and `lms_account_ready` bodies after terminal state. | `apps/api/src/services/email-outbox.ts` |
| User creation | `userRouter.create` creates only ERP `AppUser`; comment says no password input; staff authenticate by Microsoft SSO. | `apps/api/src/routers/user.ts` |
| AppUser model | `AppUser` has email, displayName, passwordHash, roles, primaryRole, isActive, tokenVersion, facilities; no Entra object ID field today. | `packages/db/prisma/schema.prisma` |

## Risk Analysis

| Risk | Why it matters | Required mitigation before implementation |
|---|---|---|
| Tenant identity write | A compromised app can create/update users within granted Graph role scope. | Separate Entra app registration; least permissions; secret rotation; audit. |
| License cost/leak | Bad mapping or duplicate jobs can consume licenses. | SKU preflight; idempotent jobs; reconciliation report. |
| Temporary password exposure | Password can leak through logs, email body, queue row, trace, screenshots. | Never store plaintext; no logs; scrub outbox body; force password change. |
| Partial failure | User created but license/email fails. | Step-state job table; retry/resume; repair UI; no hidden half-success. |
| Deprovision error | Disabled wrong staff or removed license too early. | Two-step confirmation; audit; reversible disable before delete. |
| Permission overreach | `Directory.ReadWrite.All` is too broad for MVP. | Avoid unless official docs prove a needed operation cannot use narrower permission. |
| Existing app blast radius | Adding identity write perms to email/SSO app makes one credential too powerful. | Separate app and environment variables. |

## Non-Hallucination Boundaries

These are deliberately not assumed:

- No claim that Graph can scope `User.ReadWrite.All` to only CMC-created users by default.
- No claim that Exchange Application Access Policy protects user-management APIs; it is mailbox-oriented and not enough for identity writes.
- No claim that current tenant license SKU is known.
- No claim that Temporary Access Pass is available; it needs separate research if chosen.
- No claim that delete is safe for HR offboarding.

## Recommended Technical Direction

1. Keep ERP SSO pre-provisioning as current production-safe baseline.
2. If automation is approved, create a separate app: `CMC ERP Identity Provisioner`.
3. Use separate environment variables from current email/SSO Graph config.
4. Build a read-only diagnostic first: token acquisition + `GET /subscribedSkus`.
5. Implement onboarding as durable job, not direct route side-effect.
6. Implement deprovision as separate durable job after onboarding is proven.
7. Keep delete out of MVP; prefer disable + revoke + remove license.

## Source List

- Microsoft Learn — Create user: https://learn.microsoft.com/en-us/graph/api/user-post-users?view=graph-rest-1.0
- Microsoft Learn — Assign license: https://learn.microsoft.com/en-us/graph/api/user-assignlicense?view=graph-rest-1.0
- Microsoft Learn — List subscribed SKUs: https://learn.microsoft.com/en-us/graph/api/subscribedsku-list?view=graph-rest-1.0
- Microsoft Learn — Update user: https://learn.microsoft.com/en-us/graph/api/user-update?view=graph-rest-1.0
- Microsoft Learn — App-only access primer: https://learn.microsoft.com/en-us/entra/identity-platform/app-only-access-primer
- Local: `docs/decisions/0013-email-microsoft-graph-integration.md`
- Local: `docs/auth-sso-otp-redirection.md`
- Local: `apps/api/src/lib/graph-client.ts`
- Local: `apps/api/src/services/email-outbox.ts`
- Local: `apps/api/src/routers/user.ts`
- Local: `packages/db/prisma/schema.prisma`

## Unresolved Questions

1. Does CMC want ERP to become a Microsoft tenant identity writer, or keep manual Entra provisioning?
2. Which staff roles receive which license SKU?
3. Should onboarding use temporary password email, or a Microsoft-native method after separate research?
4. What is offboarding policy: disable only, remove license, delete after N days, or never delete?
5. Will IT accept separate app registration + separate credential + consent workflow?
