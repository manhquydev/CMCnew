# 0030 Email: split external recipients to Brevo, keep Graph for internal staff

Date: 2026-07-03

## Status

Accepted

## Context

Decision `0013` routes ALL email recipients (parents, staff, CRM) through Microsoft Graph shared
mailboxes on the M365 A1 tenant. In production, outbound mail to **external** recipients returns
SMTP `550 5.7.708` — a Microsoft tenant-side outbound-reputation/IP block ("service unavailable,
connecting IP address blocked"), not a code bug. Internal-tenant delivery (staff `@cmcvn.edu.vn`)
is unaffected because it never leaves the tenant. Result: parent/guardian notifications, LMS
account-ready emails, and receipt confirmations silently fail delivery — including the parent LMS
login OTP, the single most latency- and trust-sensitive external email in the product.

## Decision

- Introduce Brevo (transactional REST API) as a second transport for **external** recipients,
  routed by recipient domain at `enqueueEmail` (and `requestLoginOtp`) time using
  `STAFF_EMAIL_DOMAIN`.
- Keep Graph for **internal** staff mail — works today, free, no reputation issue in-tenant.
- `EmailOutbox.transport` (`graph|brevo`) persists the routing decision; `drainOutbox` branches
  per row, claiming and sending each transport's rows in a separate slice so a rate-limit on one
  transport never reschedules the other's in-flight batch. Both transports share the outbox's
  existing retry/backoff/dedup machinery.
- The parent LMS login OTP (`requestLoginOtp`) is fixed to route through the same
  `decideTransport` decision, preserving its existing synchronous fire-and-forget shape (not
  forced into the outbox queue, to keep the timing-side-channel mitigation already in that code).
- A one-time migration backfill reclassifies any row still `queued`/`sending` at deploy time via
  `decideTransport` (not a blanket `DEFAULT 'graph'`) — a row already failing against Graph's `550`
  block gets a real shot at Brevo instead of retrying the broken path to terminal failure, which
  would otherwise scrub OTP/temp-password bodies on secret-bearing templates.
- Brevo requires per-sender-address domain verification (DKIM/DNS) in the Brevo dashboard before
  go-live — an operator pre-flight action, not code.

## Alternatives Considered

1. Fix M365 tenant reputation / request delisting from Microsoft — slow, opaque, Microsoft-controlled,
   no ETA, and a recurring risk even if resolved once.
2. SendGrid or Mailgun instead of Brevo — rejected in favor of Brevo, which already has prior art in
   the organization's public marketing website (existing account, known API shape) and a free tier
   that fits current parent-notification volume.
3. Fallback external mail back to Graph when Brevo fails — rejected. Graph-external is the broken
   path; queuing a row until Brevo is configured/recovers is safer than silently delivering into the
   same blackhole that motivated this change.

## Consequences

Positive:

- Parent/guardian notifications, LMS account-ready emails, and the login OTP become deliverable
  again for external recipients.
- No regression to internal staff mail — Graph routing and its existing retry/backoff/dedup
  behavior are unchanged for `@STAFF_EMAIL_DOMAIN` recipients.
- In-flight rows already broken by the `550` block are automatically reclassified and get a fresh
  attempt window on the working transport, rather than being silently lost to terminal failure.

Tradeoffs:

- **New third-party data processor for OTP/PII.** Brevo's SaaS backend receives, in cleartext JSON,
  the exact contents of `otp_login` (one-time login codes) and `lms_account_ready` (student login ID
  + plaintext temp password) — the same two template kinds this codebase already flags as
  secret-bearing (`SECRET_KINDS` in `apps/api/src/services/email-outbox.ts`, scrubbed from the DB
  once sent). This is a new external processor for that data, outside this codebase's own RLS/RBAC
  access-control model.
  - **Accepted, explicit decision:** the existing marketing-website Brevo account is reused, not a
    new isolated account/sub-account — fastest path (no new domain verification needed), at the
    cost of sharing dashboard access between marketing/website staff and this new, more sensitive
    data class (parent OTP codes, student temp passwords).
  - **Operator follow-up required before go-live** (not resolved by this decision alone): record the
    actual retention window configured for sent-email content/logs in the Brevo account dashboard,
    and record the actual list of people/roles who currently have dashboard access — that list is
    now the access boundary for OTP codes and temp passwords, not just contact-form marketing leads.
- **Staff-domain enforcement is not added at account creation.** `decideTransport` treats "not
  `@STAFF_EMAIL_DOMAIN`" as synonymous with external/parent, but `apps/api/src/routers/user.ts`
  only validates `z.string().email()` at staff account creation — domain membership is enforced
  later, only at SSO login (`apps/api/src/lib/sso.ts`). A staff account created with a non-staff
  address (data-entry error, or a contractor onboarded before their M365 mailbox exists) would have
  `account_security_alert`/`payslip_ready`/`account_welcome` silently routed through Brevo instead
  of Graph. Accepted, not fixed here — account-creation domain validation is a separate concern
  (provisioning validation, not email transport routing).
- No fallback of external mail back to Graph, and the OTP path has no queue — if the decided
  transport isn't configured when a parent requests an OTP, the send silently no-ops (same
  behavior `sendEmailNow` already had when Graph alone was unconfigured).

## Follow-Up

- Operator pre-flight before go-live: verify the Brevo sender address (DKIM/DNS) in the Brevo
  dashboard; confirm the real provisioned Brevo tier's rate limit (do not assume any unsourced
  figure) and size `BREVO_RATE_PER_RUN` against it; record the sent-email retention window and the
  actual list of people with Brevo dashboard access, per the accepted-risk note above.
- No admin/CLI tool exists to re-route already-enqueued outbox rows if the staff/external domain
  split (`STAFF_EMAIL_DOMAIN`) changes after go-live — tracked as a future DEBT.md item, not needed
  for this decision's actual problem (fixing the `550 5.7.708` external-delivery block).
- Relationship to `0013`: this decision extends `0013`'s recipient-routing clause; `0013`'s outbox
  design (no-op until configured, retry/backoff/dedup) is retained and generalized to two transports.
  `0013` itself is not edited.
