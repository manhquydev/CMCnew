# Auth redirection: Microsoft SSO (ERP) + Email OTP (LMS parent)

**Status:** designed 2026-06-26 · supersedes the password-based auth additions in this branch
**Decisions:** [0013](decisions/0013-email-microsoft-graph-integration.md) (email) + this doc (auth shift)
**Entra app:** `CMC` · Client ID `bf0f8dc1-48c5-4f1f-9199-d5e5b41e4a75` · Tenant `4dd49669-ef56-4163-9210-dba5b7101600` · Single-tenant · **Client Secret** (not certificate)

This is the authoritative log of how staff (ERP) and parent (LMS) sign-in change, what is removed,
and what config the Azure side needs. Nothing here stores a Microsoft password in our DB.

---

## 1. Why this changes

The org's Entra ID already hosts an app registration. We move authentication onto it:

- **ERP / staff** → **Single Sign-On via OpenID Connect (OIDC)**. No staff passwords managed by ERP
  (except a break-glass path for super_admin). Identity is asserted by Microsoft; we trust the
  validated `id_token`.
- **LMS / parent** → **passwordless Email OTP**. A parent proves they own a registered email by
  entering a 6-digit code we email them through Microsoft Graph. No parent passwords stored.

The same shared mailbox + Graph sender built for transactional email is reused to send OTP — but
**OTP sends synchronously** (the 1-min outbox worker is too slow for a 3–5 minute code).

## 2. What is KEPT, CHANGED, REMOVED (vs the current branch)

| Area | Action | Detail |
|------|--------|--------|
| Email outbox engine + Graph client | KEEP | `email-outbox.ts`, `graph-client.ts` |
| Payslip + parent-meeting emails | KEEP | Phase 03/05 unchanged |
| Graph auth | CHANGE | certificate → **client secret** (`GRAPH_CLIENT_SECRET`); cert stays optional |
| Staff login (password) | CHANGE | demoted to **break-glass for super_admin only**; everyone else uses SSO |
| Parent login (password) | REMOVE | replaced by Email OTP; `ParentAccount.passwordHash` becomes nullable/unused |
| Student login (loginCode+password) | KEEP | untouched — parent is the LMS actor; student path unchanged |
| Activation links (parent_welcome / staff_welcome) | REMOVE | onboarding handled by SSO (staff) / first OTP (parent) |
| Password reset (staff + parent) | REMOVE | no passwords to reset; staff use SSO, parents use OTP |
| `ActivationToken` model + service | REMOVE | dropped via a new migration; replaced by `login_otp` |
| `account_security_alert` email | KEEP | still a valid notification on deactivate/role-change |

## 3. ERP staff — SSO (OIDC authorization-code flow)

Library: **`@azure/msal-node`** `ConfidentialClientApplication` (Microsoft-recommended). The validated
`id_token` is mapped to an existing `AppUser`; we then mint the SAME internal session JWT
(`signSession`) and set the existing staff cookie — so the rest of the app is unchanged.

```
[ERP login page]  "Đăng nhập bằng tài khoản CMC EDU"
      │ click
      ▼
GET /auth/sso/login ── build authorize URL (PKCE + state in a short-lived cookie),
      │                scope: openid profile email, tenant-locked authority
      ▼
[login.microsoftonline.com/<tenant>]  ← only @cmcvn.edu.vn org accounts (single-tenant)
      │ user authenticates
      ▼
GET /auth/sso/callback?code&state
      │  • verify state (CSRF) + PKCE
      │  • acquireTokenByCode → id_token
      │  • VALIDATE: issuer == tenant, aud == clientId, email/upn ends @cmcvn.edu.vn
      │  • find AppUser by email; NOT found OR inactive → 403 (no JIT — admin pre-creates)
      │  • signSession(claims) → set staff cookie (same as today)
      ▼
[ERP app]  authenticated, no password involved
```

Validation rules (all mandatory):
- `iss` matches `https://login.microsoftonline.com/<tenant>/v2.0`; `aud` == our client id.
- Email domain == `cmcvn.edu.vn` (env `STAFF_EMAIL_DOMAIN`) — a second lock on top of single-tenant.
- Account must already exist and be active → otherwise access denied (decision: admin pre-provisions).
- `state` + PKCE `code_verifier` carried in an httpOnly, short-TTL cookie; rejected if missing/mismatched.

Break-glass: the existing `auth.login(email,password)` stays, but is **restricted to super_admin**
(so `admin@cmc.local`, which isn't an @cmcvn.edu.vn identity, can still get in if Azure is down).

Azure config (dev/ops, one-time): add Redirect URIs for each environment to the CMC app —
`https://<erp-host>/auth/sso/callback` (+ `http://localhost:4000/auth/sso/callback` for dev).

## 4. LMS parent — Email OTP (passwordless)

```
[LMS login page]  parent enters email
      │
      ▼
POST /lmsAuth/otpRequest { email }
      │  • throttle by ip + email (anti-spam, anti-enumeration → always 200)
      │  • find active ParentAccount by email; if none → return ok silently
      │  • generate 6-digit code; store login_otp { emailHash, codeHash, expiresAt(+5m),
      │                                            attempts:0, consumedAt:null }
      │  • sendViaGraph(SYNC) the otp_login email via the notify mailbox
      ▼
[parent inbox]  6-digit code
      │
      ▼
POST /lmsAuth/otpVerify { email, code }
      │  • load newest unconsumed login_otp for emailHash; checks: not expired,
      │    attempts < MAX(5), codeHash matches  → else attempts++ and reject
      │  • consume (single use); signLmsSession({kind:'parent'}) → set LMS cookie
      ▼
[LMS app]  authenticated as parent
```

Brute-force defense (6 digits = 1e6 space): max 5 attempts per code, 5-min expiry, single-use,
per-ip + per-email request throttle, newest-code-only. No account enumeration (same response whether
the email is registered or not). Codes stored hashed (SHA-256), never plaintext.

Dev without Graph: when `GRAPH_*` is unconfigured, `otpRequest` logs the code to the server console
(dev only) so the flow is testable before the tenant secret is supplied. Never log codes in prod.

## 5. Data model changes

```prisma
model LoginOtp {
  id         String    @id @default(uuid()) @db.Uuid
  emailHash  String    @map("email_hash")      // sha256(lower(email)) — index, no PII at rest
  codeHash   String    @map("code_hash")       // sha256(code)
  expiresAt  DateTime  @map("expires_at")
  attempts   Int       @default(0)
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  @@index([emailHash, createdAt])
  @@map("login_otp")
}
```
- `ParentAccount.passwordHash` → made **nullable** (parents no longer set a password; OTP only).
- `ActivationToken` model + `activation_token` table → **dropped** (new migration).
- RLS: `login_otp` is super-only (issued/verified by no-session endpoints under super-bypass).

## 6. Environment (additions; secrets never committed)

```dotenv
# Microsoft Entra app "CMC" — SSO (staff) + Graph app-only (OTP/email)
ENTRA_TENANT_ID="4dd49669-ef56-4163-9210-dba5b7101600"
ENTRA_CLIENT_ID="bf0f8dc1-48c5-4f1f-9199-d5e5b41e4a75"
ENTRA_CLIENT_SECRET=""                 # supplied later by IT; unset = SSO + OTP disabled
ERP_SSO_REDIRECT_URI="http://localhost:4000/auth/sso/callback"
STAFF_EMAIL_DOMAIN="cmcvn.edu.vn"
# Graph email/OTP sender (app-only Mail.Send). Reuses ENTRA_* secret.
GRAPH_CLIENT_SECRET="${ENTRA_CLIENT_SECRET}"
GRAPH_SENDER_NOTIFY="..."  GRAPH_SENDER_PAYROLL="..."  GRAPH_SENDER_HR="..."
```

## 7. Azure portal checklist (dev/ops)

1. App "CMC" → Certificates & secrets → **New client secret** → copy value into `ENTRA_CLIENT_SECRET`.
2. Authentication → **Redirect URIs (Web)** → add each ERP env callback (`.../auth/sso/callback`).
3. API permissions → **Microsoft Graph → Application → `Mail.Send`** → **Grant admin consent**.
4. (Recommended) Exchange RBAC scope so the app can only `Mail.Send` from the 3 shared mailboxes.
5. SPF/DKIM/DMARC on the sending domain (see `plans/260626-email-graph-integration/phase-06-*`).

## 8. Implementation phases (revised)

| # | Work | Risk |
|---|------|------|
| R1 | graph-client → client-secret auth; `ENTRA_*`/`GRAPH_CLIENT_SECRET` env | low |
| R2 | Remove superseded: activation + password-reset endpoints/service/templates; drop `activation_token`; `ParentAccount.passwordHash` nullable | auth |
| R3 | LMS parent **Email OTP**: `login_otp` model, `otpRequest`/`otpVerify`, sync Graph send, throttle | **auth** |
| R4 | ERP staff **SSO (OIDC)**: `@azure/msal-node`, `/auth/sso/login` + `/callback`, id_token validation, AppUser match, break-glass restricted to super_admin | **auth** |
| R5 | Frontend: ERP "Đăng nhập CMC EDU" button + LMS email→OTP screens | normal |
| R6 | Azure config + live smoke test (secret + redirect URIs supplied) | ops |
```
