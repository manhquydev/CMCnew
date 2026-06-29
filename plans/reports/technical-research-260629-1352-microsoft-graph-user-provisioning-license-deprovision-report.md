---
title: "Technical Research: Microsoft Graph User Provisioning + License + Deprovision"
date: 2026-06-29
lane: high-risk
input_type: maintenance-request
status: completed
sources: 9
---

# Technical Research: Microsoft Graph User Provisioning + License + Deprovision

## Executive Summary

CMCnew can build an ERP-driven Microsoft Entra user lifecycle flow: create staff user via Microsoft Graph `POST /users`, assign Microsoft 365 license via `POST /users/{id}/assignLicense`, generate a temporary password with `forceChangePasswordNextSignIn`, then notify staff through the existing Graph email path.

But this is **high-risk**. Unlike current CMCnew Graph email use, this new flow requires app-only permissions that can write tenant identities. If the app secret leaks or the app is abused, attacker impact moves from “send mail as approved mailboxes” to “create/disable/delete users, set passwords, and change licenses”. Recommendation: do not add this to the existing SSO/email app registration. Use a **separate Entra app registration**, separate secret/certificate, separate runtime feature flag, explicit audit table, and a dry-run/sandbox-first rollout.

Recommended sequence:

1. Keep current state for now: ERP staff uses SSO; admin pre-provisions Entra user manually.
2. If automation is accepted: implement **onboarding only** first: create user disabled? or enabled with temp password, assign license, send one-time credential email, store no plaintext password after send.
3. Add deprovision as a separate story: disable account, revoke sessions, remove licenses, then optional soft-delete after HR retention policy.

## Research Methodology

- Sources consulted: 9
- Source quality: official Microsoft Learn + local CMCnew docs/code + GitNexus code graph.
- Date: 2026-06-29.
- Key terms: Microsoft Graph `POST /users`, `passwordProfile`, `assignLicense`, `subscribedSkus`, `accountEnabled`, `revokeSignInSessions`, app-only access, least privilege.

## Project Context

### Existing CMCnew direction

- `docs/decisions/0013-email-microsoft-graph-integration.md` accepts Microsoft Graph only for outbound email via `/users/{mailbox}/sendMail` with outbox, no-op when `GRAPH_*` is missing, and mailbox scoping.
- `docs/auth-sso-otp-redirection.md` moves ERP staff auth to Microsoft SSO and says staff accounts must already exist and be active; no just-in-time user creation.
- Current code has `apps/api/src/lib/graph-client.ts` for email only. It uses client credentials and sends via `/users/{mailbox}/sendMail`.
- Current `apps/api/src/services/email-outbox.ts` already scrubs secret-bearing email bodies for `otp_login` and `lms_account_ready`, useful pattern if temporary password email is added.

### Meaning

This proposed provisioning flow changes the trust boundary. Current app can send email. New app can manage identities. Treat as a new security decision, not as an extension of the email feature.

## Key Findings

### 1. Creating users is supported by Microsoft Graph

Official endpoint:

```http
POST /users
```

Minimum required fields for normal tenant user creation:

- `accountEnabled`
- `displayName`
- `mailNickname`
- `userPrincipalName`
- `passwordProfile`

Microsoft example includes:

```json
{
  "accountEnabled": true,
  "displayName": "Adele Vance",
  "mailNickname": "AdeleV",
  "userPrincipalName": "AdeleV@contoso.com",
  "passwordProfile": {
    "forceChangePasswordNextSignIn": true,
    "password": "temporary-password"
  }
}
```

Permissions for create user:

| Context | Least privilege per Microsoft docs |
|---|---|
| Delegated work/school | `User.ReadWrite.All` |
| Application | `User.ReadWrite.All` |
| Higher privilege | `Directory.ReadWrite.All` |

Security note: application `User.ReadWrite.All` is still broad tenant write power.

### 2. Password profile has special permission implications

Microsoft docs list `User-PasswordProfile.ReadWrite.All` as the least privileged permission to update `passwordProfile` during user update.

For create user, `passwordProfile` is required. For later reset, avoid building password reset unless absolutely needed. Prefer Microsoft self-service password reset or Temporary Access Pass if tenant licensing/policy supports it.

CMCnew implication:

- Generate password once.
- Never store plaintext password in DB.
- If queued email contains temporary password, scrub `bodyHtml` after terminal state, matching existing `email-outbox.ts` secret scrub pattern.
- Force `forceChangePasswordNextSignIn: true`.
- Never log temporary password outside dev-only controlled test.

### 3. License assignment is a separate API and permission

Official endpoint:

```http
POST /users/{id | userPrincipalName}/assignLicense
```

Request body:

```json
{
  "addLicenses": [
    { "skuId": "license-sku-guid", "disabledPlans": [] }
  ],
  "removeLicenses": []
}
```

Removing licenses uses same endpoint:

```json
{
  "addLicenses": [],
  "removeLicenses": ["license-sku-guid"]
}
```

Permissions:

| Operation | Least privileged application permission |
|---|---|
| List available SKUs | `LicenseAssignment.Read.All` |
| Assign/remove user license | `LicenseAssignment.ReadWrite.All` |

Need preflight:

- Call `GET /subscribedSkus`.
- Check `capabilityStatus == Enabled`.
- Check `prepaidUnits.enabled - consumedUnits > 0`.
- Store mapping from ERP role/job type to `skuPartNumber`/`skuId` in config, not code.
- Consider group-based licensing later; direct assignment is OK for MVP but harder to reason about at scale.

### 4. Deprovisioning is multi-step, not just delete

Recommended offboarding sequence:

1. Disable account:

```http
PATCH /users/{id}
{ "accountEnabled": false }
```

2. Revoke sign-in sessions:

```http
POST /users/{id}/revokeSignInSessions
```

3. Remove licenses:

```http
POST /users/{id}/assignLicense
{ "addLicenses": [], "removeLicenses": ["sku-guid"] }
```

4. Optional later deletion:

```http
DELETE /users/{id}
```

Microsoft says deleted users and assigned resources move to a temporary container; restore within 30 days restores them. After 30 days, permanent deletion frees assigned resources.

Recommended CMCnew default: **disable + revoke + remove license**, keep Entra user soft-retained. Delete only after HR/admin retention decision.

Permissions:

| Deprovision step | Least privileged app permission |
|---|---|
| Disable account | `User.EnableDisableAccount.All` + `User.Read.All` |
| Revoke sessions | `User.RevokeSessions.All` |
| Remove license | `LicenseAssignment.ReadWrite.All` |
| Delete user | `User.ReadWrite.All` |

Important Microsoft note: for app-only sensitive actions, Microsoft may require the application to be assigned a sufficiently privileged Entra role for privileged users. Do not let ERP automate lifecycle for Global Admin / privileged accounts.

### 5. App-only access is powerful by design

Microsoft app-only access means the app acts as itself, without a human signed in. Microsoft explicitly says app-only access is usually broader and more powerful than delegated access and should be used only where needed.

CMCnew implication:

- A compromised app credential can perform all Graph roles granted to the app.
- Existing app `CMC` already handles SSO and Mail.Send. Adding identity write permissions there enlarges blast radius.
- Create a separate app registration: e.g. `CMC ERP Identity Provisioner`.
- Separate secret/certificate from `ENTRA_CLIENT_SECRET` and `GRAPH_CLIENT_SECRET`.
- Prefer certificate auth if operations can manage certificate rotation; otherwise client secret with short expiry + rotation runbook.

## Comparative Analysis

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Manual Entra pre-provision + ERP SSO | Lowest security risk; matches current docs | More admin work | Best default now |
| ERP app-only creates users + assigns licenses | Smooth onboarding; single HR workflow | Broad tenant-write permission; credential risk | Use only with separate app + approval |
| Delegated admin action from ERP | Human accountability; privilege follows admin role | More UX work; still needs consent; harder backend flow | Good later version |
| Group-based license assignment | Cleaner license governance | Need group management and tenant policy | Consider after direct MVP |
| Microsoft Entra Lifecycle Workflows | Native governance/offboarding | Licensing/complexity; ERP integration less direct | Evaluate if tenant supports it |

## Recommended Architecture for CMCnew

```text
[ERP HR/Admin]
   │ approve create/deactivate staff
   ▼
[CMCnew API: identity-provisioning service]
   │ durable job + audit log + idempotency key
   ▼
[Separate Entra app: CMC ERP Identity Provisioner]
   │ app-only Graph permissions
   ▼
[Microsoft Graph]
   ├─ POST /users
   ├─ GET /subscribedSkus
   ├─ POST /users/{id}/assignLicense
   ├─ PATCH /users/{id}
   └─ POST /users/{id}/revokeSignInSessions
```

### Boundary rules

- ERP `AppUser` is source of business role/facility.
- Entra user is source of authentication identity.
- Store Entra `user.id` on `AppUser` once linked.
- Do not create Entra user for parent/student. Current LMS uses Email OTP and student login path.
- Never JIT-create staff at SSO callback. SSO should still require existing active `AppUser`.

## Data Model Recommendation

Add only when implementation starts:

| Model/table | Purpose |
|---|---|
| `identity_provisioning_job` | One row per create/deactivate/license job; status, attempts, idempotency key |
| `app_user.entra_user_id` | Link ERP staff user to Entra object ID |
| `identity_provisioning_audit` or existing audit event | Record actor, action, request, Graph result, no secrets |

Fields to avoid:

- No plaintext password.
- No client secret.
- No Graph access token.
- No full Graph error body if it can include sensitive tenant data; store redacted summary.

## Permission Set: Minimal Practical App-Only Bundle

For onboarding + deprovision MVP:

| Need | Permission |
|---|---|
| Create user | `User.ReadWrite.All` |
| Read license inventory | `LicenseAssignment.Read.All` |
| Assign/remove license | `LicenseAssignment.ReadWrite.All` |
| Disable account | `User.EnableDisableAccount.All` + `User.Read.All` |
| Revoke sessions | `User.RevokeSessions.All` |

Avoid unless explicitly needed:

- `Directory.ReadWrite.All` — broader than needed for these flows.
- Delete users in MVP — deletion is operationally risky.
- Password reset after onboarding — use Entra-native reset flow if possible.

## Implementation Recommendations

### Phase 0 — Decision + tenant prep

1. Create a high-risk story folder.
2. Create an Architecture Decision Record because this changes identity authority and tenant-write permissions.
3. Confirm with IT:
   - verified staff domain
   - license SKU to assign
   - whether A1 license terms cover all staff use
   - secret vs certificate
   - who can grant admin consent
   - retention/offboarding deletion policy

### Phase 1 — Read-only proof

1. New config loader for identity provisioner app.
2. `GET /subscribedSkus` only.
3. Show available SKU inventory in admin-only diagnostic endpoint or CLI.
4. No user writes yet.

### Phase 2 — Onboarding MVP

1. Admin creates ERP `AppUser`.
2. Job creates Entra user with generated temporary password.
3. Assign configured license.
4. Send temporary password email through existing outbox.
5. Store `entraUserId` and mark provisioning status.
6. Scrub temporary password email body after sent/failed terminal status.

### Phase 3 — Offboarding MVP

1. Admin deactivates staff in ERP.
2. Job disables Entra account.
3. Job revokes sessions.
4. Job removes license.
5. Keep deleted-user step manual until retention decision.

### Phase 4 — Hardening

1. Certificate auth or secret rotation runbook.
2. Alert on failed jobs and permission errors.
3. Periodic reconciliation: ERP active staff vs Entra active users vs license assigned.
4. Break-glass manual procedure.

## Failure Modes and Controls

| Failure mode | Control |
|---|---|
| Graph user created, license assignment fails | durable job step state; retry license step; show admin repair action |
| Email send fails after temp password created | set temp password unusable? or reset again on retry; do not expose password in logs |
| Duplicate provisioning click | idempotency key based on `appUserId` + action |
| License pool exhausted | preflight `subscribedSkus`; block before user creation or create unlicensed disabled user only if approved |
| App credential compromised | separate app, least permissions, rotation, monitor Entra audit logs, disable app immediately |
| Deprovision accidentally triggered | two-step confirmation for staff with privileged CMC roles; reversible disable before delete |
| Privileged Entra admin targeted | block automation for privileged Entra roles; manual-only |

## Code Shape Recommendation

Do not extend `apps/api/src/lib/graph-client.ts` directly. It is currently email-specific and uses mailbox sender config.

Prefer new cohesive module boundary:

- `apps/api/src/lib/graph-identity-client.ts`
- `apps/api/src/services/identity-provisioning.ts`
- router endpoints under existing admin/user router only after GitNexus impact analysis.

Reason: email Graph and identity Graph have different permissions, secrets, audit needs, and blast radius.

## Validation Plan

Minimum checks before production:

- Unit tests for request builders: create user, assign license, disable, revoke, remove license.
- Integration tests with mocked Graph fetch for partial failures and idempotency.
- Live tenant smoke test in sandbox only:
  - create test user
  - assign test license
  - login/change temp password manually
  - disable user
  - revoke sessions
  - remove license
  - verify cleanup.
- Harness trace must record proof without secrets.

## Sources & References

### Official Microsoft docs

- Create user: https://learn.microsoft.com/en-us/graph/api/user-post-users?view=graph-rest-1.0
- Assign/remove license: https://learn.microsoft.com/en-us/graph/api/user-assignlicense?view=graph-rest-1.0
- List subscribed SKUs: https://learn.microsoft.com/en-us/graph/api/subscribedsku-list?view=graph-rest-1.0
- Update user: https://learn.microsoft.com/en-us/graph/api/user-update?view=graph-rest-1.0
- Revoke sign-in sessions: https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0
- Delete user: https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0
- Permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- App-only access primer: https://learn.microsoft.com/en-us/entra/identity-platform/app-only-access-primer

### Local CMCnew references

- `docs/decisions/0013-email-microsoft-graph-integration.md`
- `docs/auth-sso-otp-redirection.md`
- `apps/api/src/lib/graph-client.ts`
- `apps/api/src/services/email-outbox.ts`
- GitNexus query: Graph email outbox / SSO / OTP flows.

## Final Recommendation

Proceed only if the user accepts the security trade-off:

> ERP becomes an identity writer in Microsoft tenant.

If accepted, implement as **separate app-only integration**, with least permissions, durable jobs, strong audit, no plaintext secrets, and deprovision in a separate phase. Do not merge this into the current email/SSO Graph app.

## Unresolved Questions

1. Should ERP be allowed to create Microsoft Entra users at all, or should CMC keep manual pre-provisioning?
2. Which license SKU should staff receive by role: teacher, sales, manager, accountant, director?
3. Should onboarding email include temporary password, or should IT prefer Entra-native Temporary Access Pass / reset flow?
4. What is the staff offboarding retention policy: disable only, remove license, delete after N days, or never delete?
5. Will CMC use certificate auth for the identity provisioner app, or client secret with short rotation?
6. Should privileged staff accounts be excluded from automation?
