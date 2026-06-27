# Entra / Microsoft Graph User Provisioning — Technical Report

**Date:** 2026-06-27  
**Status:** DONE  
**Scope:** Programmatic user creation, licensing, role mapping, and onboarding patterns for Vietnamese tutoring ERP.

---

## 1. Creating Microsoft 365 / Entra User Accounts via Graph

### Endpoint & Request Body

**POST** `https://graph.microsoft.com/v1.0/users`  
**Content-Type:** `application/json`

Minimal request to create a member user:

```json
{
  "accountEnabled": true,
  "displayName": "Staff Name",
  "mailNickname": "staffname",
  "userPrincipalName": "staffname@contoso.com",
  "passwordProfile": {
    "forceChangePasswordNextSignIn": true,
    "password": "ComplexPassword123!"
  }
}
```

Response: **201 Created** + user object (includes `id`, `userPrincipalName`, `createdDateTime`).

**Reference:** [Create User — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/user-post-users?view=graph-rest-1.0)

### Required Permissions

**Application Permission (app-only/daemon):** `User.ReadWrite.All`  
**Delegated Permission (signed-in user):** `User.ReadWrite.All`

**Yes, app-only (client-credentials) CAN create users.** The daemon app uses its own client ID and client secret to obtain an access token (no user sign-in required). Tenant admin must grant consent for the `User.ReadWrite.All` application permission in Entra admin center → Enterprise apps → API permissions → Grant admin consent.

**Security caveat:** `User.ReadWrite.All` is a high-privilege permission (can create, modify, delete users). Apply principle of least privilege; if your app only needs to create, consider scoped alternatives or delegated+user consent where feasible.

**Reference:** [Microsoft Graph Permissions Overview](https://learn.microsoft.com/en-us/graph/permissions-overview), [Best Practices — Graph Permissions](https://learn.microsoft.com/en-us/graph/best-practices-graph-permission)

### License Assignment

**Prerequisite:** Set `usageLocation` on the user first.

**PATCH** `/users/{userId}` with body `{ "usageLocation": "US" }` (two-char country code).  
Then **POST** `/users/{userId}/assignLicense`:

```json
{
  "addLicenses": [
    {
      "skuId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ],
  "removeLicenses": []
}
```

Response: **200 OK** + updated user object.

**Note:** `assignLicense` itself does NOT set `usageLocation`; you must PATCH the user separately first, or assignment will fail with "License assignment cannot be done for user with invalid usage location."

**Reference:** [assignLicense — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/user-assignlicense?view=graph-rest-1.0)

### Temporary Access Pass (TAP) — Passwordless Alternative

Instead of sending a temporary password in the API response, create a **Temporary Access Pass** for the new user:

- **What:** One-time or multi-use time-limited passcode valid for ~hours to days.
- **Benefit:** User can sign in, register phish-resistant methods (FIDO2, passkey, Windows Hello), without ever setting a password.
- **Admin setup:** Enable TAP in Entra admin center → Authentication methods → Temporary Access Pass policy.
- **Graph call:** `POST /users/{userId}/authentication/temporaryAccessPassMethods`.

**2025–2026 context:** Microsoft's "passwordless-by-default" roadmap ranks TAP above passwords. Recommended for modern onboarding.

**Reference:** [Configure TAP — Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-temporary-access-pass)

---

## 2. Mapping Entra Groups/App Roles into OIDC `id_token`

### Groups Claim

By default, the `id_token` does NOT include group membership. Enable via **Token configuration** (Entra admin center):

1. App registration → Token configuration → Add optional claim.
2. Select **ID token** → **groups**.
3. Choose:
   - **Groups assigned to the application** (recommended for large orgs; only groups explicitly assigned to the app).
   - **All Groups** (returns SecurityGroup, DirectoryRole, DistributionList; not app-assigned groups).

### App Roles in `id_token`

Define app roles in the app registration manifest (property `appRoles`). When a user is assigned to an app role, Entra includes a `roles` claim in the token listing those roles.

**Limitation:** If you emit group data as roles, only groups appear in the `roles` claim; app roles won't show.

### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Groups/roles in token** | Auth decision made on client; lower latency for role checks; no app-side lookup | Token size grows; Entra is source of truth; harder to iterate authz without redeploying app; potential stale data if group membership changes mid-session |
| **App-side roles (ERP database)** | App fully controls authorization; no token bloat; instant changes; Entra only handles authn | Requires graph/directory lookup on every session or startup; higher latency; external call dependency |

**Current recommendation:** Store core authz in your ERP database (you already do this). Use `groups` claim only for audit/team visibility if needed; keep authorization logic in your code.

**Reference:** [Configure Group Claims — Entra ID](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims), [ID Token Claims Reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), [Configure Group Claims & App Roles](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles)

---

## 3. Best-Practice Onboarding Pattern: Auto-Provision vs. Admin-Created

### Pattern (a): App auto-provisions via Graph

**Flow:** New staff logs in via Entra SSO → app doesn't find user record → app calls Graph to create account programmatically.

**Pros:**
- Zero admin overhead; on-demand user creation.
- Instant access for new starters.

**Cons:**
- **Permission risk:** App daemon holds `User.ReadWrite.All` (high privilege; if app is compromised, attacker can create/modify users).
- **Compliance/audit:** Unaudited creation; harder to enforce naming, licensing, group assignment policies.
- **License waste:** Easy to over-create; no approval gate.

### Pattern (b): Admin creates in M365 admin center; app only stores authz

**Flow:** Tenant admin manually creates user in Entra/M365 → user SSO logs in → app auto-detects (first login triggers local record creation; Graph query optional).

**Pros:**
- **Security:** App does not hold `User.ReadWrite.All`; only `User.Read.All` for optional directory lookup.
- **Audit trail:** Entra logs admin action; clear who created the account.
- **Cost control:** Admin approves license assignment; prevents waste.
- **Policy enforcement:** Admin ensures naming, group membership, MFA, device compliance before user can access app.

**Cons:**
- Requires admin action for every onboarding (training/process overhead).

### Recommendation for ERP

**Pattern (b) is more secure and operationally sound for this context:**

1. **Tenant admin** creates user in M365 admin center (or automates via provisioning service like Workday connector + SCIM, if available in future).
2. **On SSO first login:** App reads `sub` + optional `name` / `email` from `id_token`, creates a local staff record in ERP with default role (admin/user approves in app later).
3. **App uses `User.Read.All`** only if you need to fetch additional profile data (office phone, manager, department) via Graph; not for creation.
4. **Defer TAP creation to admin:** If passwordless is required, admin creates the TAP in Entra; app does not create it.

**Why:**
- Aligns with zero-trust principle (minimize app privilege).
- Matches existing ERP authz architecture (roles in your database, not Entra).
- Integrates cleanly with M365 licensing (no app creating unlicensed accounts).
- Audit trail clear (admin → Entra → SSO login → app record).

**Reference:** [User Provisioning Overview](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning), [Plan Auto User Provisioning](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/plan-auto-user-provisioning)

---

## Summary

| Question | Answer |
|----------|--------|
| **Create user endpoint?** | POST /users, minimal body: accountEnabled, displayName, mailNickname, userPrincipalName, passwordProfile. Response 201. |
| **Permission for app-only?** | `User.ReadWrite.All` (application), requires admin consent. Yes, daemon can create users. |
| **Licensing?** | PATCH /users/{id} to set usageLocation first, then POST /users/{id}/assignLicense. |
| **TAP for passwordless?** | Yes, modern alternative to temp password; admin enables policy, app or admin creates pass. |
| **Groups/roles in token?** | Feasible via optional claims (groups claim or appRoles); trade-off vs. app-side authz (token size vs. flexibility). Keep roles in ERP. |
| **Onboarding pattern?** | Pattern (b) preferred: admin creates → user SSO → app auto-discovers + stores authz. Lower risk, clearer audit trail, simpler ops. |

---

## References

- [Create User — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/user-post-users?view=graph-rest-1.0)
- [assignLicense — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/user-assignlicense?view=graph-rest-1.0)
- [Microsoft Graph Permissions Overview](https://learn.microsoft.com/en-us/graph/permissions-overview)
- [Best Practices — Graph Permissions](https://learn.microsoft.com/en-us/graph/best-practices-graph-permission)
- [Configure TAP — Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-temporary-access-pass)
- [Configure Group Claims — Entra ID](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims)
- [ID Token Claims Reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [Configure Group Claims & App Roles](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles)
- [User Provisioning Overview](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning)

---

**Status:** DONE  
**Summary:** Microsoft Graph v1.0 supports app-only user creation (User.ReadWrite.All) via POST /users + separate license assignment (requires usageLocation). Pattern (b) — admin-created accounts + app-side authz — recommended for security, audit, and operational clarity over app auto-provisioning.  
**Concerns:** None. All facts verified against current Microsoft Learn documentation (2025/2026).
