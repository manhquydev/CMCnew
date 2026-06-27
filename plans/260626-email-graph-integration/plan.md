# Email System Integration — Microsoft 365 (A1 Education) via Microsoft Graph API

**Status:** BACKEND IMPLEMENTED & VERIFIED (179 tests green) · UI pages + Phase 06 config pending
**Branch:** `feature/email-graph-integration` (worktree)

## ⚠️ Auth re-architecture (2026-06-26, later same day)
The org provided the Entra app "CMC" and a new auth direction. Staff → **Microsoft SSO (OIDC)**;
parent LMS → **Email OTP passwordless**. This **supersedes** the password-based activation (Phase 02)
and password-reset (Phase 04) added earlier in this branch. Authoritative design + redirection log:
**`docs/auth-sso-otp-redirection.md`** (revised phases R1–R6). Graph auth switched cert → **client
secret** (R1, done). Removal of superseded code + OTP + SSO (R2–R5) pending.

## Build status (2026-06-26)
- **Phase 01–05 backend: DONE & verified** — API typecheck + lint clean; 8 unit + 171 integration
  tests pass against a live Postgres (migrations applied). Email is no-op until `GRAPH_*` env is set.
- **Remaining to be fully usable end-to-end:**
  - Frontend `/activate` + `/reset` + `/forgot` pages in `apps/lms` (parent) and `apps/admin` (staff)
    — thin forms over the verified endpoints (`auth.activateVerify/activateSetPassword/
    requestPasswordReset/resetPassword`, same on `lmsAuth`). Backend contracts are final.
  - Phase 06: Microsoft tenant config + DNS + live smoke test (operator runbook, no code).
- **Deferred (saved):** receipt + certificate emails (Phase 03 design retained, not built).

**Lane:** HIGH-RISK (Auth · External provider · Data model · Audit/security · Public contracts)
**Owner:** Nguyễn Mạnh Quý · **Created:** 2026-06-26

---

## 1. Goal

Add an outbound email capability to CMCnew that uses the organization's existing
**Microsoft 365 A1 Education** tenant as the mail infrastructure, via the
**Microsoft Graph API** (`/users/{mailbox}/sendMail`) with **OAuth2 client-credentials +
certificate authentication** (no passwords/secrets), free **Shared Mailboxes**, and an
**Exchange RBAC** scope that limits the app to those mailboxes only.

The system must be **code-complete and runnable with email disabled** (no-op when
unconfigured, mirroring `apps/api/src/lib/callio-client.ts`). Going live then requires only
**Microsoft-side configuration** (App Registration, certificate, RBAC, Shared Mailboxes, DNS)
plus filling environment variables — see Phase 06.

## 2. Design in one paragraph

Business code never calls Graph directly. Instead, every trigger writes a row into a new
**`EmailOutbox`** table inside the *same DB transaction* as the business action (transactional
outbox pattern — atomic, idempotent via `dedupKey`). A **cron worker** (reusing the existing
`node-cron` + `DISABLE_CRON` pattern in `apps/api/src/index.ts`) drains the outbox at a
controlled rate (≤20 emails/min, well under Exchange's 30/min cap), renders each message from a
template, and sends it through a thin **Graph mailer client** (`graph-client.ts`) authenticated
by certificate. On HTTP 429 it backs off exponentially and retries. Recipients are resolved to
**`ParentAccount.email`** (parents/LMS), **`AppUser.email`** (staff), or **`Contact.email`**
(CRM leads) — `Student` has no email by design (homework-platform positioning), so all
student-facing mail goes to the parent.

```
business txn ──enqueue──▶ EmailOutbox (queued) ──cron worker (rate-limited)──▶ graph-client.sendMail
                                                         │ 429 → exponential backoff
                                                         └─ render template (subject + HTML)
```

## 3. Phases

| # | Phase | File | Risk | Depends on |
|---|-------|------|------|-----------|
| 01 | Core email engine (outbox table, graph client, worker, env, no-op) | [phase-01](phase-01-core-email-engine.md) | data-model | — |
| 02 | Account provisioning (parent LMS login + staff onboarding, activation link) | [phase-02](phase-02-account-provisioning.md) | auth | 01 |
| 03 | Transactional documents (payslip-ready, receipt approved, certificate issued) | [phase-03](phase-03-transactional-documents.md) | contracts | 01 |
| 04 | Password reset + security alerts (NEW auth flow) | [phase-04](phase-04-password-reset.md) | **auth (gate)** | 01 |
| 05 | Notification mirroring (parent-meeting reminder, opt-in digests) | [phase-05](phase-05-notification-mirroring.md) | low | 01 |
| 06 | Microsoft config + DNS + live-test runbook (the "plug-in" step) | [phase-06](phase-06-microsoft-config-and-live-test.md) | ops | 01–05 |

Phases 02–05 are independent of each other and each depend only on Phase 01.

## 4. Email trigger catalog (v1 scope, derived from codebase audit)

| Trigger | Recipient | Email field | Mailbox | Phase | In-app mirror (today) |
|---------|-----------|-------------|---------|-------|----------------------|
| Parent LMS account created/enrolled | Parent | `ParentAccount.email` | `notify` | 02 | none — credentials never delivered |
| Staff account created | Staff | `AppUser.email` | `notify` | 02 | none |
| Password reset requested | Staff / Parent | `AppUser.email` / `ParentAccount.email` | `notify` | 04 | none (flow absent) |
| Payslip finalized | Staff | `AppUser.email` | `payroll` | 03 | none |
| ~~Receipt approved (phiếu thu)~~ | Parent | `ParentAccount.email` | `notify` | **DEFERRED** | staff in-app only |
| ~~Certificate issued~~ | Parent | `ParentAccount.email` | `notify` | **DEFERRED** | none |
| Parent-meeting reminder (T-1) | Parent | `ParentAccount.email` | `notify` | 05 | `notification` SSE |
| Grade/badge/level-up digest (opt-in) | Parent | `ParentAccount.email` | `notify` | 05 | `notification` SSE |
| Security alert (deactivation/role change) — optional | Staff | `AppUser.email` | `notify` | 04 | none |

Three Shared Mailboxes (free, no license): `notify` (general/LMS/CRM), `payroll` (payslips),
`hr` (staff onboarding) — mapped from env so names are config, not code.

## 5. Acceptance criteria

- API builds, typechecks, and all existing tests pass with email **unconfigured** (no-op).
- With a mock Graph client, an enqueued email is rendered and "sent" exactly once; a re-tick
  never double-sends (idempotent `dedupKey`); a 429 triggers backoff not data loss.
- Each business trigger enqueues atomically with its business write (rolls back together on error).
- No Graph credentials/secrets ever appear in source or git; all via env + on-disk certificate.
- Phase 06 runbook lets an admin go live by editing env + DNS only, with a documented smoke test.

## 6. Out of scope (this round)

- Inbound email / reading mailboxes; ticketing from email.
- Bulk marketing campaigns (research §A flags A1 commercial-use compliance — see Phase 06 note).
- Adding an `email` field to `Student` (parent is the contact by design).
- SMS/OTP onboarding bridge (research §H.1) — noted as a future enhancement, not built.

## 7. Key references

- Research dossier: `plans/research/Email ERP Với Microsoft 365.md`
- Pattern to mirror: `apps/api/src/lib/callio-client.ts` (env no-op + network/pure split)
- Cron pattern: `apps/api/src/index.ts` (lines 256–274, `DISABLE_CRON`)
- Outbox/notification precedent: `apps/api/src/services/parent-meeting-reminder.ts`
- HTML render precedent: `apps/api/src/services/receipt-html.ts`, `certificate-html.ts`
