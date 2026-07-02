# Red-Team Security Adversary Review — Brevo External Email Routing Plan

Reviewer role: Security Adversary + Fact Checker + Contract Verifier (Standard tier, 4 phases).
Scope: `plans/260702-2352-email-brevo-external-routing/{plan.md,phase-01..04}.md`.

## Finding 1: Plan does not fix the OTP login path — the highest-value external email flow stays on broken Graph

- **Severity:** Critical
- **Location:** Plan-wide (missing from all 4 phase files); scope gap vs `plan.md` Problem statement.
- **Flaw:** The plan's problem statement says "parent/guardian notifications, LMS account-ready, receipt emails silently fail delivery" and proposes routing external recipients to Brevo. But the routing change is applied ONLY to `enqueueEmail`/`drainOutbox` in `apps/api/src/services/email-outbox.ts`. The synchronous, non-outbox send path `sendEmailNow` (`apps/api/src/lib/graph-client.ts:160-165`) is never touched, and its only production caller — `requestLoginOtp` in `apps/api/src/services/login-otp.ts:51` — sends the parent passwordless-login OTP code directly via `sendViaGraph`, with no `decideTransport`/Brevo option at all.
- **Failure scenario:** Parents are external recipients by definition (they are never `@cmcvn.edu.vn`). After this plan ships and Brevo goes live, every OTHER external email kind (receipt, lms_account_ready, ops alerts to external ops addresses) will deliver via Brevo — but the parent LMS login OTP, arguably the single most latency- and trust-sensitive external email in the product, will continue to hit the exact `550 5.7.708` tenant-reputation block this plan exists to solve. Parents will be unable to log into the LMS at all, and nothing in the plan's test matrix (phase-04 §A/B) or pre-flight checklist (phase-04 §C) would catch this because no test exercises `login-otp.ts`.
- **Evidence:** `D:\project\CMCnew\apps\api\src\services\login-otp.ts:8,51` — `import { sendEmailNow, graphMailerFromEnv, ... } from '../lib/graph-client.js'` and `void sendEmailNow({ mailbox: 'notify', to: normEmail(email), subject, html }, deps)`. The plan's own scout report acknowledges this call site exists and bypasses the outbox — `plans/260702-2352-email-brevo-external-routing/scout/scout-01-current-email-system-report.md:8,34`: *"`sendEmailNow(msg, deps?)` — sync send bypassing outbox (used for OTP)"* / *"`services/login-otp.ts:51` (`sendEmailNow`, not `enqueueEmail`...)"* — yet none of phase-01 through phase-04's Files/Implementation/Test sections mention `login-otp.ts` or `sendEmailNow`. VERIFIED(login-otp.ts:8,51) as the unaddressed bypass.
- **Suggested fix:** Either (a) route `login-otp.ts` through `enqueueEmail` (accepting the outbox's async latency, which the code comment at `login-otp.ts:49-50` explicitly tried to avoid — "Fire the Graph send WITHOUT blocking the response... shrinking the timing side-channel"), or (b) add an equivalent `decideTransport`-based branch directly in `sendEmailNow`/`requestLoginOtp` so OTP mail also gets a Brevo path. This must be a phase-2 (or new phase) deliverable, not deferred — shipping without it means the plan's stated problem is only partially solved for the highest-stakes flow.

## Finding 2: Brevo capacity claim ("1k RPS base") conflates API rate limit with the free-tier's 300 emails/day quota; quota exhaustion is not distinguished from permanent failure

- **Severity:** High
- **Location:** Phase 04, section C.1 ("Brevo account") and plan.md "Key risks" table (deploy-ordering risk).
- **Flaw:** Phase-04 §C.1 states: *"create/confirm account + note plan tier (base = 1k RPS, sufficient per research §2)"*. Brevo's actual Free plan sends 300 emails/day total, not 1,000 requests/second — the RPS figure describes API call-rate ceilings on paid plans, not send volume. The cron worker fires every minute (`apps/api/src/index.ts:511-512`, `cron.schedule('* * * * *', ...)`) draining up to `RATE_PER_RUN = 20` rows per tick (`email-outbox.ts:22`), i.e. a theoretical ceiling of 20×60×24 = 28,800 sends/day — nearly 100x a free-tier daily quota.
- **Failure scenario:** If the operator provisions (or the pre-flight checklist fails to catch) a free/low-tier Brevo plan, once the 300/day quota is hit Brevo returns a quota-exceeded error (typically HTTP 402/406, not 429). `sendViaBrevo` (phase-01) only special-cases `res.status === 429`; any other non-2xx falls into the generic `throw new Error(...)` branch, which `drainOutbox` treats as a countable attempt. After `MAX_ATTEMPTS = 5` (email-outbox.ts:23) those legitimate external emails (receipts, account-ready, OTP-if-fixed) are marked `failed` and terminally dropped — recreating the exact "silently fails delivery" problem this plan exists to solve, just against a new vendor's quota instead of M365's reputation block, and with no distinct alerting for "quota exhausted" vs "genuine send failure."
- **Evidence:** `plans/.../phase-04-validation-and-preflight.md:71` (quoted above). Cross-checked against Brevo's published free-plan limit of 300 emails/day (developers.brevo.com/help.brevo.com, verified via web search 2026-07). `sendViaBrevo` 429-only branch: `plans/.../phase-01-brevo-transport-module.md:73-76`. Cron cadence: `D:\project\CMCnew\apps\api\src\index.ts:511-512`. `RATE_PER_RUN`: `D:\project\CMCnew\apps\api\src\services\email-outbox.ts:22`.
- **Suggested fix:** Pre-flight checklist must explicitly state the REQUIRED plan tier in terms of daily send volume (not RPS), size it against realistic parent-volume peaks, and phase-01/02 should special-case Brevo's quota-exceeded response (whatever its actual status/body shape is — verify against Brevo docs, not assumed) to reschedule (like `RateLimitError`) rather than counting it as a failed attempt.

## Finding 3: New third-party data processor receives OTP codes, temp passwords, and student/parent PII with no documented compliance/access-control review

- **Severity:** High
- **Location:** Phase 03 ("Decision record 0029"), Scope section; plan.md Solution shape.
- **Flaw:** Once `decideTransport` routes external recipients to Brevo, Brevo's SaaS backend will receive, in cleartext JSON, the exact contents of `otp_login` (one-time login codes) and `lms_account_ready` (student login ID + plaintext temp password) templates for every external recipient — see `apps/api/src/services/email-templates.ts:172-206`. These are the two kinds the codebase itself already flags as secret-bearing (`SECRET_KINDS` in `email-outbox.ts:30`, scrubbed from the DB once sent). The plan introduces a brand-new external processor for this data but phase-03's decision-record outline has no "Data processing / compliance / access control" section — only delivery-mechanics content (context, decision, alternatives, scope, verification).
- **Failure scenario:** Brevo retains sent-email content/logs for some retention window by default (standard for transactional-email SaaS). Anyone with access to that Brevo account/dashboard (which, per the plan's own "Alternatives rejected" note, is the SAME org's Brevo account already used for the public marketing website — `docs/decisions/...` cites `D:\project\CMC\src\website\lib\email\brevo-transactional-email-client.ts` as prior art) could view parent OTP codes and student temp passwords outside of the ERP's own RBAC/RLS boundary — a data exposure path that bypasses this codebase's entire access-control model (`withRls`, facility scoping, super-admin gating) with no mention that this exposure was assessed or accepted.
- **Evidence:** `email-templates.ts:103-111` (`otp_login`, `lms_account_ready` payload shapes with `code`/`loginCode`/`tempPassword`); `email-outbox.ts:30` (`SECRET_KINDS`); plan.md line 42 lists Brevo prior-art at `D:\project\CMC\src\website` (VERIFIED — file exists: `D:\project\CMC\src\website\lib\email\brevo-transactional-email-client.ts`); phase-03 content outline (`phase-03-decision-record.md:19-51`) has no compliance/data-processor/access-isolation heading.
- **Suggested fix:** Phase-03 ADR must add an explicit "Data processing / third-party exposure" section: confirm whether a NEW isolated Brevo account/organization is used (not the marketing site's), document retention settings in the Brevo dashboard, and record who inside the org can view sent-email content. `FEATURE_INTAKE.md`'s own hard-gate list includes "Audit/security" and "External systems" — this ADR is already flagged high-risk for those reasons but the content doesn't address them.

## Finding 4: `decideTransport`'s domain check has no format validation on `to`, and misrouting is silent

- **Severity:** Medium
- **Location:** Phase 02, section "2. `enqueueEmail` — decide transport".
- **Flaw:** `decideTransport(to)` (`phase-02-outbox-transport-routing.md:67-72`) calls `to.trim().toLowerCase().endsWith(...)` with no assertion that `to` is a syntactically valid email at all. Malformed/empty `to` values (e.g. from a data-entry bug upstream, or a parent record with a blank `email` field slipping past `receipt.parentEmail &&` truthiness checks with a non-empty-but-invalid string) silently fall through to `brevo` (since they won't match the staff suffix), get POSTed to Brevo, and only surface as a generic 400/422 from Brevo after consuming a `MAX_ATTEMPTS` retry cycle — no validation-at-the-boundary as required by this org's own trust-boundary conventions.
- **Failure scenario:** Not itself a security bypass, but it's a silent data-quality/observability gap: bad `to` values are now indistinguishable at insert time from legitimate Brevo-routed rows, so a malformed-email bug upstream (e.g. in a CRM import) surfaces 5 retries and ~2 hours later as a `failed` row with a Brevo error string, instead of failing fast at `enqueueEmail`.
- **Evidence:** `phase-02-outbox-transport-routing.md:67-72` — no `to` format check anywhere in `decideTransport` or the surrounding `enqueueEmail` insert path (`email-outbox.ts:57-81`, unchanged by this plan).
- **Suggested fix:** Not blocking, but worth a cheap guard: reject/flag obviously malformed `to` (no `@`) at `enqueueEmail` time rather than queuing it for either transport.

## Finding 5: `RateLimitError` message string is Graph-specific, but plan explicitly defers unifying it — creates confusing operator-facing errors when Brevo rate-limits

- **Severity:** Medium
- **Location:** Phase 01, section "Reuse `RateLimitError` and `SendDeps`".
- **Flaw:** The plan reuses `RateLimitError` from `graph-client.ts` for the Brevo path too. `RateLimitError`'s constructor hardcodes `"Graph sendMail rate-limited; retry after ${retryAfterSec}s"` (`graph-client.ts:27-32`, VERIFIED). The plan's own note (`phase-01-brevo-transport-module.md:18-21`) acknowledges this is "cosmetic only" because the message is "never persisted on the 429 path." That claim is accurate for the 429 code path (`drainOutbox` reschedule branch at `email-outbox.ts:190-204` doesn't write `lastError` for `RateLimitError`) — VERIFIED — but the same `RateLimitError` class could plausibly be logged elsewhere in future ops tooling (e.g. `console.error` in `login-otp.ts:52`, or any future observability hook) where a Brevo 429 would misleadingly say "Graph sendMail rate-limited," actively misleading an on-call engineer diagnosing which vendor is throttling.
- **Failure scenario:** During an incident where Brevo starts 429-ing (e.g. Finding 2's quota exhaustion, or a burst), any log/alert surface that prints the error message will say "Graph" — sending whoever's debugging toward the wrong vendor's dashboard/support channel, extending incident time exactly when parent-facing email is degraded.
- **Evidence:** `graph-client.ts:27-32`; `phase-01-brevo-transport-module.md:18-21` acknowledges the string is "Graph-flavored" and defers the fix as YAGNI.
- **Suggested fix:** Cheap fix, not deferred: pass a transport label into `RateLimitError` (or extract it to a transport-neutral `lib/email-transport.ts` as the plan's own "alternative if the team objects" already proposes) — this is a few lines, not worth the YAGNI deferral given it directly affects incident response during the exact failure mode (rate limiting) this class exists to signal.

## Fact-Check Summary

| Claim | Status |
|---|---|
| `graph-client.ts` exports at `:39` (`graphMailerFromEnv`), `:107` (`sendViaGraph`), `:27` (`RateLimitError`), `:69` (`OutgoingEmail`), `:80` (`SendDeps`) | VERIFIED (graph-client.ts:39,107,27,69,80) |
| `EmailOutbox` schema `packages/db/prisma/schema.prisma:790-810`, no transport column | VERIFIED (schema.prisma:790-810) |
| `enqueueEmail` insert `email-outbox.ts:62-74`; `runEmailOutbox` `:115-129`; claim query `:138-156`; hardcoded send `:166-170` | VERIFIED (all line ranges match) |
| `sso.ts:31-33` `emailAllowed` endsWith logic | VERIFIED (sso.ts:31, logic matches) |
| `docker-compose.prod.yml:100`, `docker-compose.prod.tls.yml:71`, `scripts/prod-build-env.sh:52` carry `STAFF_EMAIL_DOMAIN` | VERIFIED (all three) |
| `docs/decisions/0028-refund-ledger.md` is latest, 0029 free | VERIFIED (0028 exists, no 0029) |
| Brevo prior art at `D:\project\CMC\src\website` | VERIFIED (brevo-transactional-email-client.ts exists) |
| "base = 1k RPS, sufficient" (phase-04 §C.1) | FAILED — conflates API RPS ceiling with free-tier 300 emails/day send quota (see Finding 2) |
| `login-otp.ts` OTP path addressed by the plan | FAILED — not mentioned in any phase file despite being flagged in the plan's own scout report (see Finding 1) |

## Contract Verification: `EnqueueInput` / `enqueueEmail` callers

`enqueueEmail<K>(tx, input: EnqueueInput<K>)` signature is UNCHANGED by this plan (phase-02 explicitly notes "No change to `EnqueueInput` — callers already pass a resolved `to` string"). All current call sites (grep-verified, `apps/api/src/routers/*.ts` + `apps/api/src/lib/error-alert.ts` + `apps/api/src/services/parent-meeting-reminder.ts`):

- `apps/api/src/routers/payroll.ts:723` — payslip_ready, staff email (internal, unaffected by routing change beyond going through `decideTransport`).
- `apps/api/src/routers/finance.ts` (receipt-approve flow, ~line 945) — `lms_account_ready`, `receipt.parentEmail` (external — now Brevo-routed).
- `apps/api/src/routers/finance.ts` (~line 1410) — `receipt` kind, dedup-sensitive insert-then-conditional-logEvent pattern (unaffected by transport addition; still relies on the same unique-violation short-circuit).
- `apps/api/src/routers/user.ts:356` (`emailWelcome`) — `account_welcome`, staff (internal).
- `apps/api/src/routers/user.ts:375` (`emailSecurityAlert`) — `account_security_alert`, staff email; NOTE if an admin changes a staff member's on-file email to a non-`@cmcvn.edu.vn` address, this now silently reroutes a security-sensitive alert through the new external Brevo transport — not called out anywhere in the plan's risk table.
- `apps/api/src/lib/error-alert.ts:55` — `ops_error_alert`, `process.env.OPS_ALERT_EMAIL` (transport depends entirely on whether ops uses a staff-domain address; not analyzed in the plan).
- `apps/api/test/email-outbox.int.test.ts` — existing test caller, extended per phase-04.

None of these callers require code changes (confirmed, since `EnqueueInput` shape is untouched) — the Contract Verifier check found no broken callers, but flags that two of the six production call sites (`emailSecurityAlert`, `ops_error_alert`) have recipient addresses whose domain is NOT guaranteed to be staff-controlled, and the plan does not analyze the transport implications for those two security/ops-relevant kinds.

## Unresolved Questions

1. Does the plan intend to fix `login-otp.ts` in this same effort, or is a follow-up phase/plan required? (Finding 1 — blocking, needs an explicit answer before phase-02 ships, since shipping without it does not achieve the plan's stated goal.)
2. What Brevo plan tier will actually be provisioned in prod, and does it cover realistic daily parent-email volume with headroom? (Finding 2)
3. Is a dedicated Brevo account/org being created for CMCnew, separate from the existing public-website marketing account? (Finding 3)
