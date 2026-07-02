# Phase 03 — Decision record 0029 (dual-transport email split)

## Goal

Write a new ADR documenting why external mail is being split from Graph to Brevo, grounded in the
real `550 5.7.708` production symptom. **Do NOT edit `0013`** — that decision stays accepted; 0029
extends/supersedes its recipient-routing clause.

No code dependency — can be written in parallel with phases 1/2.

## Files

- CREATE `docs/decisions/0029-email-brevo-external-transport-split.md` (next free number; 0028 is
  the latest — verified `docs/decisions/0028-refund-ledger.md`).
- Register in the durable layer after writing: `.\scripts\bin\harness-cli.exe decision add`
  (per `docs/FEATURE_INTAKE.md` high-risk requirement — this touches External systems + Public
  contract for email delivery).

## Content outline (follow `docs/templates/decision.md` + the 0013 shape)

- **Status:** accepted · **Date:** 2026-07-03 · **Lane:** high-risk (External systems · Public
  contracts · Existing behavior).
- **Context:**
  - 0013 routes ALL recipients (parents, staff, CRM) through Graph shared mailboxes.
  - Production symptom: outbound-**external** mail returns SMTP `550 5.7.708` — Microsoft tenant
    outbound-reputation / IP block on the M365 tenant. Cite Microsoft's own NDR reference
    ("5.7.708 … service unavailable, connecting IP address blocked"). This is an M365 tenant-side
    deliverability condition, **not a code bug** — internal-tenant (staff `@cmcvn.edu.vn`) delivery
    is unaffected because it never leaves the tenant.
  - Result: parent/guardian notifications, LMS account-ready, receipt emails silently fail delivery.
- **Decision:**
  - Introduce Brevo (transactional REST API) as a second transport for **external** recipients,
    routed by recipient domain at `enqueueEmail` time using `STAFF_EMAIL_DOMAIN`.
  - Keep Graph for **internal** staff mail (works, free, no reputation issue in-tenant).
  - `EmailOutbox.transport` (`graph|brevo`) persists the routing decision; `drainOutbox` branches
    per row; both transports share the outbox's retry/backoff/dedup machinery.
  - Brevo requires **per-sender-address** domain verification (DKIM/DNS) in the Brevo dashboard —
    a pre-flight operator action, gated before go-live (phase 04).
- **Alternatives rejected:**
  - *Fix M365 tenant reputation / delisting* — slow, opaque, Microsoft-controlled; no ETA; recurring risk.
  - *SendGrid/Mailgun* — Brevo already prior-art in the org's public website; free tier fits parent volume.
  - *Fallback external→Graph* — rejected: Graph-external is the broken path; queuing until Brevo is
    live is safer than delivering to a blackhole.
- **Scope:** In — external-recipient routing, Brevo transport, transport column, pre-flight checklist.
  Deferred — Brevo inbound/bounce webhooks, batch `messageVersions`, attachment support for
  brevo-routed kinds.
- **Relationship to 0013:** extends 0013's "Recipients" clause; 0013's outbox + no-op-until-configured
  design is retained and generalized to two transports.
- **Data processing / third-party exposure (red-team Finding 4, accepted — new section, was missing
  from the original outline):** routing external recipients to Brevo means Brevo's SaaS backend
  receives, in cleartext JSON, the exact contents of `otp_login` (one-time login codes) and
  `lms_account_ready` (student login ID + plaintext temp password) templates — the same two kinds
  this codebase already flags as secret-bearing (`SECRET_KINDS` in `email-outbox.ts:30`, scrubbed
  from the DB once sent). This is a new external processor for that data, outside this codebase's
  own RLS/RBAC access-control model entirely. **Confirmed decision (plan validation session,
  2026-07-03): the existing marketing-website Brevo account is reused (not a new isolated
  account/sub-account), an explicit accepted risk, not an oversight.** Must document before go-live:
  - Retention window for sent-email content/logs configured in that Brevo account's dashboard.
  - Who inside the org currently has dashboard access to that account (marketing + ops staff who
    manage the public website today) — this list is now also the access boundary for parent OTP
    codes and student temp passwords, a materially different sensitivity class than contact-form
    marketing leads. Record the actual list of people/roles, not just "documented as a risk."
  - Prior art citation (`D:\project\CMC\src\website\lib\email\brevo-transactional-email-client.ts`)
    was for the API call shape only — it does not, on its own, make shared-account access acceptable;
    the acceptance is a separate, explicit operator decision recorded here.
  - This ADR is already in the high-risk lane for "Audit/security" + "External systems" per
    `docs/FEATURE_INTAKE.md`'s hard-gate list — this section is what actually satisfies that flag;
    the original outline had no content addressing it at all.
- **Accepted risk — staff email domain not enforced at account creation (Finding 9):**
  `decideTransport` treats "not `@STAFF_EMAIL_DOMAIN`" as synonymous with external/parent, but
  `apps/api/src/routers/user.ts:83` only validates `z.string().email()` at staff account creation,
  not domain membership (only enforced later, at SSO login). A staff account with a non-staff-domain
  email would have security-sensitive notifications (`account_security_alert`, `payslip_ready`)
  silently routed through Brevo instead of Graph. Accepted, not fixed in this plan — account-creation
  domain validation is a separate concern from email transport routing.
- **Verification:** phase-04 integration tests + operator pre-flight smoke send to a real external
  inbox (mail-tester.com header check for DKIM pass).

## Risks

| Risk | L×I | Mitigation |
|------|-----|-----------|
| ADR claims `550 5.7.708` root cause without evidence | Low×Med | Cite Microsoft NDR doc + the observed prod NDR; mark as tenant-side, not code |
| Number collision with a parallel ADR | Low×Low | Re-check `ls docs/decisions` for next free number at write time |

## Rollback

Doc-only. Revert the file + `harness-cli decision` row if the direction is abandoned.

## Done = observable

- `docs/decisions/0029-*.md` exists, follows the template headings, references 0013 and the NDR code.
- `harness-cli decision` durable row added.
