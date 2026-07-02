# Red-Team Review — Brevo External Email Routing Plan

Reviewer: code-reviewer (assumption-destroyer pass)
Plan: `plans/260702-2352-email-brevo-external-routing/` (plan.md + phase-01..04)
Verification tier: Standard (Fact Checker + Contract Verifier applied)

## Pre-check: the flagged stale assumption is NOT present

The task brief warned this plan might still claim the old Brevo account's domain verification
"already covers" the new sender. Checked `phase-03-decision-record.md:37-38` and
`phase-04-validation-and-preflight.md:73-74` — both correctly state **per-sender verification is
required** and explicitly say "the old public-website domain verification does NOT carry over."
`plan.md` only cites the old website as vendor prior-art (free-tier fit), never as a verification
shortcut. This assumption was corrected in this revision — not re-flagging it as a finding.

---

## Finding 1: Brevo capacity claim ("1,000 RPS base plan") has no verifiable source and drives a YAGNI-skip-batching decision

- **Severity:** High
- **Location:** `research/researcher-01-brevo-api-report.md` §2 ("Base plan: 1,000 requests/sec"),
  cited by `plan.md:73` ("parent volume fits single-send at 1k RPS base") and
  `phase-04-validation-and-preflight.md:71` ("base = 1k RPS, sufficient per research §2").
- **Flaw:** The research report's own Sources section (lines 114-120) lists only generic Brevo docs
  URLs (send-a-transactional-email, api-limits, domain-authentication) — none of which is cited
  against the specific "1,000 RPS / 2,000 RPS / 6,000 RPS" tier table in §2. Brevo's actual
  commercial plans are priced and capped by **monthly email volume** (e.g. free/Starter tiers cap
  at a low daily send count), not by a flat requests-per-second ceiling that scales with plan tier
  the way this report describes. No plan-name-to-RPS mapping is verifiable from the citations given.
- **Failure scenario:** The plan uses this unverified number to justify "Out of scope: Brevo ...
  batch `messageVersions` endpoint (YAGNI — parent volume fits single-send at 1k RPS base)"
  (`plan.md:72-73`) and to close the pre-flight checklist item without a real limit check
  (`phase-04:71`, "sufficient per research §2"). If the actual purchased/free Brevo tier caps out
  far below this figure, external mail (which was already broken via Graph — the entire point of
  this plan) could start failing again under Brevo 429s/402s at a much lower volume than assumed,
  and nothing in phase-04's pre-flight checklist actually confirms the real numeric cap against the
  account that will be used in prod.
- **Suggested fix:** Add a pre-flight checklist step that reads the actual rate/volume limit from
  the live Brevo dashboard for the account/plan being provisioned (not from the research doc), and
  remove "per research §2" as the stated justification for skipping batch support.

## Finding 2: Shared per-tick send cap (`RATE_PER_RUN = 20`) is not adjusted for two transports

- **Severity:** High
- **Location:** Phase 2, section "3. `runEmailOutbox`" / "4. `drainOutbox`"; underlying constant at
  `apps/api/src/services/email-outbox.ts:22` (`const RATE_PER_RUN = 20; // < Exchange 30/min cap`).
- **Flaw:** VERIFIED — `email-outbox.ts:22` ties this constant explicitly to Graph/Exchange's 30/min
  limit. Phase 2's claim query (`phase-02-outbox-transport-routing.md:106-114`) adds
  `transport: { in: configured }` to the `WHERE` clause but keeps `take: RATE_PER_RUN` as a single
  shared ceiling across BOTH transports, and does not raise or split it per-transport. The cron
  interval is confirmed at `apps/api/src/index.ts:511` (`cron.schedule('* * * * *', ...)`, comment at
  :508-510: "every minute, send up to 20 queued emails").
- **Failure scenario:** `apps/api/src/services/parent-meeting-reminder.ts:61-74` enqueues one email
  per notifiable parent per meeting, per class, in a tight loop — plausibly dozens to low-hundreds of
  rows in a single reminder tick across facilities. All of these route to `brevo` (parents never match
  `STAFF_EMAIL_DOMAIN`). Under the shared 20-row/minute claim, this backlog now also competes with
  any concurrently queued internal Graph mail (welcome emails, payslip-ready, security alerts) for
  the same batch slot — a burst of parent-meeting reminders can starve internal Graph mail of its
  slice of the 20-row window, or vice versa, even though Brevo's real capacity (per Finding 1, however
  imprecise) is not the bottleneck — the shared constant is.
- **Suggested fix:** Split the claim/cap per transport (e.g. up to 20 Graph + N Brevo, N sized to
  Brevo's actual verified limit) instead of one shared `RATE_PER_RUN` calibrated only for Exchange.

## Finding 3: Domain-based routing assumes every internal recipient has an `@STAFF_EMAIL_DOMAIN` address — not enforced by the data model

- **Severity:** Medium
- **Location:** Phase 2, section "2. `enqueueEmail` — decide transport" (`decideTransport`,
  `phase-02-outbox-transport-routing.md:67-72`); cross-cutting acceptance criteria in `plan.md:60`
  ("Staff-domain recipient → graph; any other → brevo").
- **Flaw:** VERIFIED — `apps/api/src/routers/user.ts:83` validates the `email` input only with
  `z.string().email()`; there is no server-side check that a newly created staff account's email
  matches `STAFF_EMAIL_DOMAIN`. `STAFF_EMAIL_DOMAIN` is enforced only at SSO **login** time via
  `emailAllowed()` (`apps/api/src/lib/sso.ts:25-33`), not at account creation. `decideTransport`
  (and the plan's cross-cutting acceptance criteria) treats "not `@STAFF_EMAIL_DOMAIN`" as
  synonymous with "external/parent," but that equivalence is not guaranteed for staff records.
- **Failure scenario:** A staff account created with a non-`cmcvn.edu.vn` address (data-entry error,
  or a contractor/role like `ctv_mkt`/`hr` onboarded before their M365 mailbox exists — these roles
  were explicitly kept in the recent RBAC consolidation per project memory) will have its
  `account_welcome` (`user.ts:356`), `account_security_alert` (`user.ts:375`), and `payslip_ready`
  (`apps/api/src/routers/payroll.ts:723-730`) notifications silently routed through the new
  external/Brevo transport instead of Graph. `account_security_alert` in particular carries account
  action/audit content that decision 0013/0029 never evaluated for third-party-vendor transport —
  the whole premise of "Brevo = external" (`phase-03-decision-record.md`) is broken for these rows.
- **Suggested fix:** Either validate staff email domain at `user.create` time, or route by
  `mailbox` kind (Graph mailbox keys `notify|payroll|hr` are always staff-internal use cases per
  `email-outbox.ts:41`) combined with domain, not domain alone.

## Finding 4: `attachRef` is already dead on both transports, but the plan frames it as Brevo-specific scope-cutting

- **Severity:** Medium
- **Location:** Phase 1, "Notes" section (`phase-01-brevo-transport-module.md:86-89`); Phase 2 message
  construction (`phase-02-outbox-transport-routing.md:117`).
- **Flaw:** VERIFIED — `EmailOutbox.attachRef` (`packages/db/prisma/schema.prisma:799`) and
  `EnqueueInput.attachRef` (`apps/api/src/services/email-outbox.ts:44,72`) exist and are persisted,
  but `grep -rn attachRef apps/api/src` finds **zero** callers passing a non-null value, and
  `drainOutbox`'s message construction (`email-outbox.ts:168`, unchanged by phase-02's
  `msg = { mailbox, to, subject, html }` at `phase-02:117`) never reads `row.attachRef` into either
  `sendViaGraph` or the new `sendViaBrevo`. Attachments are non-functional for **Graph today**, not
  just for the new Brevo path.
- **Failure scenario:** The plan's phrasing ("parent notification/receipt templates that need
  attachments today go via Graph ... payroll/hr mailboxes to staff, or attachRef is null for parent
  kinds") reads as if Graph attachment delivery is a working, load-bearing path that Brevo simply
  doesn't replicate yet. A future maintainer skimming this plan could reasonably assume Graph
  attachments work and only Brevo needs the follow-up — they don't; both are currently dead code
  for this field.
- **Suggested fix:** State plainly that `attachRef`/`msg.attachment` wiring is unimplemented for
  both transports today (pre-existing gap, not new scope), rather than framing it as a Brevo-only
  deferred item.

## Finding 5: Rollback runbook leaves the operator to choose between two conflicting actions during an incident

- **Severity:** Medium
- **Location:** Phase 2, "Rollback" section (`phase-02-outbox-transport-routing.md:159-163`).
- **Flaw:** The rollback plan reads: *"before reverting, `UPDATE email_outbox SET status='failed'`
  for `transport='brevo' AND status IN ('queued','sending')` OR leave them and re-drive after
  re-deploy."* This presents two materially different outcomes (fail the rows vs. silently strand
  them until a future re-deploy) as interchangeable operator options, decided ad hoc.
- **Failure scenario:** This plan is explicitly classified high-risk (external systems, public
  contract, existing behavior per phase-03's decision-record lane). A rollback under incident
  pressure with an undefined choice between "mark N parent notifications as permanently failed" and
  "leave them queued indefinitely, silently invisible to the SLA" is exactly the kind of decision
  that should be pre-made, not left to whoever executes the rollback.
- **Suggested fix:** Pick one default rollback action (recommend: leave queued + re-drive, since
  "no loss" is the plan's own stated rollback principle for the `BREVO_*` unset case at
  `phase-04-validation-and-preflight.md:90`) and document the other as an explicit escalation path
  only, not a coin-flip.

## Finding 6: Phase-2 claim query risk table underrates the cross-transport batch-reschedule interaction it already identified

- **Severity:** Medium
- **Location:** Phase 2, Risks table, row "Mixed-transport batch: one Brevo 429 rolls back Graph rows
  in same batch" (`phase-02-outbox-transport-routing.md:155`), rated `Low×Low`.
- **Flaw:** VERIFIED against actual code — `drainOutbox`'s `RateLimitError` handler
  (`email-outbox.ts:190-203`) reschedules **the triggering row AND every remaining claimed row**
  (`claimed.slice(i)`), regardless of transport, then `break`s the whole batch. Phase 2 keeps this
  logic unchanged and correctly notes it applies across transports, but rates the combined-transport
  case `Low×Low` without re-deriving likelihood now that a *second, independently rate-limited*
  external network call is interleaved in the same claimed batch — doubling the number of
  possible 429 sources per tick compared to the single-Graph-transport baseline this constant/logic
  was originally sized for.
- **Failure scenario:** During a burst (e.g. the parent-meeting-reminder scenario in Finding 2), a
  single Brevo 429 partway through a mixed 20-row batch reschedules any trailing Graph-bound rows in
  that same batch too, even though Graph wasn't rate-limited — a real (if bounded-to-one-tick, i.e.
  ≤60s) delay to unrelated internal mail that the risk table dismisses as `Low×Low` without
  re-assessing likelihood for the new two-transport reality.
- **Suggested fix:** Either re-rate this risk (at least Low×Med given the batch is now mixed by
  design) or scope the 429 reschedule to same-transport remaining rows only, leaving other-transport
  rows in the batch to proceed.

---

## Unresolved Questions

1. What Brevo plan/tier will actually be purchased for prod, and what does *that* dashboard show as
   its real rate/volume limit? (Finding 1 — needs a real number, not the research doc's unsourced
   figure.)
2. Is there a business reason `STAFF_EMAIL_DOMAIN`-only routing was chosen over combining it with
   `mailbox` kind (`notify|payroll|hr` are always staff-facing) for the three internal-only template
   kinds? If domain enforcement at `user.create` is out of scope for this plan, that should be an
   explicit accepted-risk line in the decision record, not silent.
