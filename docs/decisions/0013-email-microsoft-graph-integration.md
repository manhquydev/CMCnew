# 0013 — Outbound email via Microsoft 365 Graph API

- **Status:** accepted
- **Date:** 2026-06-26
- **Lane:** high-risk (Auth · Authorization · Data model · Audit/security · External systems · Public contracts)

## Context

The org has Microsoft 365 A1 Education with Exchange Online. CMCnew had no email capability. We need
to deliver account credentials, password resets, payslip notices, and parent reminders without paying
for a third-party mail service (SendGrid/Mailgun). Research: `plans/research/Email ERP Với Microsoft 365.md`.

## Decision

Use the **Microsoft Graph API** (`/users/{mailbox}/sendMail`) with **OAuth2 client-credentials +
certificate auth** (no passwords/secrets), free **Shared Mailboxes**, and an **Exchange RBAC** scope
restricting the app to those mailboxes. Send through a **transactional outbox**: business code calls
`enqueueEmail(tx, …)` (atomic, idempotent via `dedupKey`); a per-minute cron worker drains the queue
at ≤20/min and sends via Graph, with exponential backoff on HTTP 429. The system is a **no-op until
`GRAPH_*` env is configured**, so it ships to production inert and goes live by config only.

Recipients: `ParentAccount.email` (parents/LMS), `AppUser.email` (staff), `Contact.email` (CRM).
`Student` has no email by design (homework-platform positioning) — student-facing mail goes to parents.

Account onboarding uses **passwordless single-use activation links** (24h); password reset uses
single-use tokens (30m) with no account enumeration and session invalidation (`tokenVersion` bump).
Only the SHA-256 hash of any token is stored (`activation_token`, super-only RLS).

## Alternatives rejected

- **SMTP AUTH / SMTP Relay / Direct Send** — Basic Auth deprecation, 30/min cap, IP-static
  requirement, or internal-only delivery (research §B). Graph fits modern auth + external delivery.

## Scope

In: provisioning, password reset + security alerts, payslip-ready, parent-meeting reminder email.
Deferred: receipt + certificate emails; SMS/OTP onboarding bridge; inbound/bulk mail.

## Compliance note

A1 Education licensing is for genuine education orgs only (research §A). Confirm CMC qualifies before
production; otherwise move to M365 Business/Enterprise. SPF/DKIM/DMARC must be set (phase-06 runbook).

## Verification

Backend Phase 01–05 implemented and verified: API typecheck + lint clean; 8 unit + 171 integration
tests green against live Postgres (migrations applied). Go-live verification = phase-06 smoke test
after the Microsoft tenant is configured.
