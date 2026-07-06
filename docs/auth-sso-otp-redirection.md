# Auth redirection: Microsoft SSO (ERP) + Email OTP (LMS parent)

**Status:** designed 2026-06-26 · supersedes the password-based auth additions in this branch
**Decisions:** [0013](decisions/0013-email-microsoft-graph-integration.md) (email) + this doc (auth shift)
**Update (2026-07-04):** row 34's "student login (loginCode+password) unchanged" claim is
**superseded** — the student LMS login primary path is now parent phone + a fixed default
password, with the per-child `loginCode`+password retained only as a break-glass fallback. See
[decision 0033](decisions/0033-student-login-phone-identity.md) for the full model
(`lmsAuth.loginFamilyByPhone` + `lmsAuth.enterChildProfile`, Netflix-style profile picker). The
parent Email-OTP flow described below (§4) is unaffected by this change.
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
| Parent login (password) | REMOVE | replaced by Email OTP; `ParentAccount.passwordHash` becomes nullable/unused (**revived 2026-07-04**: same column now backs the family student-login credential, decision 0033 — a different login purpose, not a reversal of this OTP change) |
| Student login (loginCode+password) | SUPERSEDED (2026-07-04) | primary path is now parent phone + `Cmc2026@` (decision 0033); loginCode+password kept as break-glass fallback |
| Activation links (parent_welcome / staff_welcome) | REMOVE | onboarding handled by SSO (staff) / first OTP (parent) |
| Password reset (staff + parent) | REMOVE | no passwords to reset; staff use SSO, parents use OTP |
| `ActivationToken` model + service | REMOVE | dropped via a new migration; replaced by `login_otp` |
| `account_security_alert` email | KEEP | still a valid notification on deactivate/role-change |

## 3. ERP staff — SSO (OIDC authorization-code flow)

Library: **`@azure/msal-node`** `ConfidentialClientApplication` (Microsoft-recommended). The validated
`id_token` is mapped to an existing `AppUser`; we then mint the SAME internal session JWT
(`signSession`) and set the existing staff cookie — so the rest of the app is unchanged.

```
[ERP/teacher login page]  "Đăng nhập bằng tài khoản CMC EDU"
      │ click
      ▼
GET /auth/sso/login ── build authorize URL (PKCE + state in a short-lived cookie),
      │                store validated returnOrigin/returnPath + redirectUri in tx cookie,
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
[initiating staff host]  authenticated, no password involved
```

Validation rules (all mandatory):
- `iss` matches `https://login.microsoftonline.com/<tenant>/v2.0`; `aud` == our client id.
- Email domain == `cmcvn.edu.vn` (env `STAFF_EMAIL_DOMAIN`) — a second lock on top of single-tenant.
- Account must already exist and be active → otherwise access denied (decision: admin pre-provisions).
- `state` + PKCE `code_verifier` carried in an httpOnly, short-TTL cookie; rejected if missing/mismatched.
- Return origin is allowlisted by `ADMIN_APP_ORIGIN` + `STAFF_APP_ORIGINS`; `teacher.cmcvn.edu.vn`
  uses its own callback URI so the host-only tx/session cookies stay on the initiating staff host.
- Direct SSO starts without `returnOrigin`, `Origin`, or `Referer` fall back to the
  forwarded request host (`x-forwarded-proto` + `x-forwarded-host` / `host`) before ERP fallback.
  This keeps direct `/api/auth/sso/login` smokes host-correct behind nginx/Cloudflare.

Break-glass: the existing `auth.login(email,password)` stays, but is **restricted to super_admin**
(so `admin@cmc.local`, which isn't an @cmcvn.edu.vn identity, can still get in if Azure is down).

Azure config (dev/ops, one-time): add Redirect URIs for each staff host to the CMC app —
`https://erp.cmcvn.edu.vn/api/auth/sso/callback`,
`https://teacher.cmcvn.edu.vn/api/auth/sso/callback`,
`https://deverp.cmcvn.edu.vn/api/auth/sso/callback`,
`https://devteacher.cmcvn.edu.vn/api/auth/sso/callback`, and
`http://localhost:4000/auth/sso/callback` for local dev.

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
STAFF_APP_ORIGINS="http://localhost:5173"
STAFF_EMAIL_DOMAIN="cmcvn.edu.vn"
# Graph email/OTP sender (app-only Mail.Send). Reuses ENTRA_* secret.
GRAPH_CLIENT_SECRET="${ENTRA_CLIENT_SECRET}"
GRAPH_SENDER_NOTIFY="..."  GRAPH_SENDER_PAYROLL="..."  GRAPH_SENDER_HR="..."
```

## 7. Azure portal checklist (dev/ops)

1. App "CMC" → Certificates & secrets → **New client secret** → copy value into `ENTRA_CLIENT_SECRET`.
2. Authentication → **Redirect URIs (Web)** → add each staff-host callback (`.../api/auth/sso/callback` in nginx-served envs).
   Production live smoke now checks the ERP and teacher authorize URLs for `AADSTS50011` /
   `AADSTS900971`, which proves Microsoft accepts both redirect URIs before login. A real
   browser/MFA callback smoke is still required before calling SSO fully complete. Use
   `scripts/verify-teacher-cmcvn-interactive-sso.ps1` for that operator-assisted proof; set
   `SSO_ORIGINS=https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn` to verify both staff hosts.
3. API permissions → **Microsoft Graph → Application → `Mail.Send`** → **Grant admin consent**.
4. (Recommended) Exchange RBAC scope so the app can only `Mail.Send` from the 3 shared mailboxes.
5. SPF/DKIM/DMARC on the sending domain (see `plans/260626-email-graph-integration/phase-06-*`).

## 8. Implementation phases (revised)

| # | Work | Risk | Status |
|---|------|------|--------|
| R1 | graph-client → client-secret auth; `ENTRA_*`/`GRAPH_CLIENT_SECRET` env | low | ✅ done |
| R2 | Remove superseded: activation + password-reset endpoints/service/templates; drop `activation_token`; `ParentAccount.passwordHash` nullable | auth | ✅ done |
| R3 | LMS parent **Email OTP**: `login_otp` model, `otpRequest`/`otpVerify`, sync Graph send, race-safe attempt cap, throttle | **auth** | ✅ done |
| R4 | ERP staff **SSO (OIDC)**: `@azure/msal-node`, `/auth/sso/login` + `/callback`, id_token validation, AppUser match, break-glass restricted to super_admin | **auth** | ✅ done |
| R5 | Frontend: ERP "Đăng nhập CMC EDU" button + LMS email→OTP screens | normal | ✅ done |
| R6 | Azure config + live smoke test (secret + redirect URIs supplied) | ops | ⏳ partial: SSO-start + Entra pre-login passed; full interactive callback pending |

**Backend R1–R4 done & verified (2026-06-26):** API typecheck + lint clean; 12 unit + 172 integration
tests green against live Postgres (migrations applied). SSO + OTP are no-op until `ENTRA_CLIENT_SECRET`
is set; the dev OTP fallback logs the code (non-prod only) so the flow is testable now. `ENTRA_TENANT_ID`
must be the tenant **GUID** (not a domain). Frontend (R5) done: staff login has a "Đăng nhập bằng tài
khoản CMC EDU" button (`packages/ui/src/login-gate.tsx`) and the LMS parent tab is a two-step email→OTP
flow (`packages/ui/src/lms-login-gate.tsx`). Remaining: **R6 only** — SSO-start and Entra pre-login
smoke passed in prod; final proof still needs a real browser/MFA callback and Graph Mail.Send consent.
```
