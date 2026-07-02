# Brainstorm — email external delivery fix (Brevo) + devops prod-readiness Tier 1

Date: 2026-07-02 (session date; see chat for actual completion timestamp)
Scope: two related but independent concerns raised together — (1) external email delivery is
blocked (`550 5.7.708`), (2) broader devops/prod-readiness audit before "setting up devops again"
for real production.

## 1. Problem statement

**Email:** CMCnew sends all email via Microsoft Graph API (decision 0013), which deliberately
rejected SMTP AUTH/Direct Send. Internal (@cmc-domain) delivery works; external delivery
(parent/guardian personal email addresses) fails with `550 5.7.708 Service unavailable`.

**Devops:** operator wants a comprehensive technical/readiness re-scan before re-doing devops
setup for real production — wider coverage than the cross-plan business-flow review already done
this session (which focused on application logic, not infra).

## 2. Research: root cause of `550 5.7.708`

Confirmed via Microsoft's own documentation, not a code bug:
[NDR error codes 5.7.700–5.7.750 (Microsoft, official)](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/non-delivery-reports-in-exchange-online/fix-error-code-5-7-700-through-5-7-750),
[exception-request thread](https://learn.microsoft.com/en-us/answers/questions/5100596/how-to-contact-support-to-request-exception-for-em?forum=msoffice-all).

`5.7.708` = "Access denied, traffic not accepted from this IP" — a **tenant/IP reputation block**
Microsoft applies to new or trial-adjacent M365 tenants sending to external recipients. Fixed only
by Microsoft support exception or waiting out reputation building (24h–several days) — **no app-code
fix exists**. Internal-tenant delivery bypasses this reputation gate entirely, which matches the
observed symptom exactly (internal works, external doesn't).

## 3. Codebase findings (scouted, not assumed)

**CMCnew email system** (`apps/api/src/lib/graph-client.ts`, `apps/api/src/services/email-outbox.ts`,
`apps/api/src/services/email-templates.ts`): transactional outbox pattern — enqueue in caller's DB
transaction → cron drains ≤20/min → exponential backoff, max 5 attempts → secret bodies scrubbed
after terminal state. 7 email kinds: `otp_login`, `account_welcome`, `account_security_alert`,
`lms_account_ready`, `receipt`, `parent_meeting`, `payslip_ready`, `ops_error_alert`. Whole system
no-ops silently if Graph/Entra env vars are incomplete — no thrown error, rows just stay queued.

**Old public website** (`D:\project\CMC\src\website`, separate Cloudflare Worker deploy, NOT part
of this monorepo): uses Brevo Transactional Email API (`POST /v3/smtp/email`, REST not SMTP relay)
for contact-form admin notification + submitter confirmation. `BREVO_API_KEY`,
`BREVO_CONTACT_LIST_ID` already provisioned and the sending domain is already verified there.

**Devops/infra** (full scout in chat, condensed here): 4 compose files (dev, prod-HTTP, prod-TLS
live, jenkins); secrets via plain gitignored `.env.production`, no vault; Let's Encrypt AND a
separate Cloudflare-origin self-signed-cert path coexist without one being marked canonical; no
CPU/memory limits on any prod app/db/nginx container; Jenkins CI runs on every PR but does not
gate GitHub merge (deferred in decision 0019 — `publishChecks` not wired); deploy is automatic on
`main` merge with no staging environment and no scripted rollback (failure just logs "old stack
left running", no automated revert); backup script + restore-drill runbook are already rewritten
(`plans/260702-1109-ops-hardening/phase-02-*`) but cron install + first real restore drill are
blocked on operator VPS access, not on missing code; sole alerting is a single-instance-only
rolling error-count → one email, no dashboard, no multi-instance correctness.

## 4. Evaluated approaches — email routing

| Approach | Pros | Cons |
|---|---|---|
| **Brevo external + Graph internal, routed by `STAFF_EMAIL_DOMAIN`** (CHOSEN) | Reuses existing domain-check convention; internal mail (already working) untouched; external mail gets a transport with an already-reputable, already-verified sending domain | Two transports to maintain (small delta — both are thin HTTP clients behind the same outbox abstraction) |
| Brevo replaces Graph entirely | One transport, simplest mental model | Rewrites a working internal path (account_welcome, payslip_ready) for no reason — internal delivery isn't broken |
| Try Graph first, fallback to Brevo on failure | Could recover automatically if Microsoft lifts the reputation block later | Extra failover state machine for a block that resolves in days/via support ticket, not per-request — over-engineered for the actual failure mode (a tenant-level block doesn't intermittently succeed) |

**Recommendation held**: domain-routed dual transport. Routing decision stored at outbox-enqueue
time (not re-evaluated at drain/retry) so a mid-flight domain-rule change can't flip transport
mid-retry-sequence for the same row.

## 5. Evaluated approaches — devops readiness

Operator confirmed: harden the existing single-VPS stack, do not migrate to new infrastructure
(managed cloud/K8s) — right-sized for current scale, migrating would be premature scope.

Findings triaged into tiers by risk/effort, not restated as a flat list:

- **Tier 0 (code already done, blocked on operator VPS action only)**: backup cron install +
  first real restore drill.
- **Tier 1 (small, high-value, do first)**: reconcile the two competing TLS strategies into one
  canonical path; add resource limits to prod containers; finish decision 0019's deferred
  `publishChecks` wiring so CI actually gates GitHub merge.
- **Tier 2 (moderate, needed before calling this "real prod")**: staging environment (can reuse
  the already-existing HTTP-only prod compose file on a separate subdomain — no new file needed);
  scripted deploy rollback (redeploy previous image tag on failure).
- **Tier 3 (larger, needs an explicit is-this-worth-it call)**: off-box backup destination
  (rsync/S3-compatible target, not full DR); lightweight uptime monitoring (uptime-kuma-class tool,
  explicitly NOT Prometheus/Grafana — that's over-engineering at 1-VPS/1-instance scale); secrets
  manager — explicitly rejected as YAGNI at current team/infra size, a documented rotation
  procedure is enough.

## 6. Decisions locked with operator

1. Email routing: Brevo for external, Graph for internal, keyed on `STAFF_EMAIL_DOMAIN`.
2. Brevo integration scope: extract the transport pattern only into `apps/api` — do NOT merge the
   old public website into this monorepo (that's a separate, much larger decision, out of scope
   here).
3. Brevo account: reuse the existing Brevo account/verified sending domain from the old site,
   issue a new API key scoped to CMCnew.
4. Devops scope: harden the current VPS stack (no infra migration); Tier 1 items planned first,
   Tier 2/3 as a separate later plan.
5. This session produces a PLAN only (via `/ck:plan`, scouted/researched, red-teamed, validated
   per this repo's harness convention) — no implementation in this pass.

## 7. Next steps

Two independent plans to be created under `plans/`:
- `<timestamp>-email-brevo-external-routing/` — Brevo transport module, outbox routing logic,
  new decision record, env var additions.
- `<timestamp>-devops-tier1-hardening/` — TLS strategy reconciliation, prod container resource
  limits, Jenkins→GitHub required-check wiring.

Both go through this repo's plan → red-team → validate cycle before any code is written.

## Unresolved questions

- None blocking — all decisions needed to start planning are locked above.
