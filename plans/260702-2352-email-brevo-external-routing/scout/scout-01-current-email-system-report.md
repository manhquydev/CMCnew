# Scout 01 — Current Email System (Graph transport, outbox, templates, call sites)

## 1. `apps/api/src/lib/graph-client.ts`

- `graphMailerFromEnv(): GraphMailerConfig | null` (line 39) — reads `GRAPH_TENANT_ID||ENTRA_TENANT_ID`, `GRAPH_CLIENT_ID||ENTRA_CLIENT_ID`, `GRAPH_CLIENT_SECRET||ENTRA_CLIENT_SECRET`, `GRAPH_CERT_PATH`, `GRAPH_SENDER_NOTIFY/PAYROLL/HR`. **Silent no-op**: returns `null` if tenant/client/(secret-or-cert)/any sender is missing (line 51) — never throws. Returns a plain data object `GraphMailerConfig` (`tenantId, clientId, clientSecret?, certPath?, certPassword?, senders: Record<MailboxKey,string>`) — NOT a mailer function/class; it's inert config consumed by `sendViaGraph`.
- `senderAddress(cfg, mailbox): string` (63) — throws if mailbox key unconfigured.
- `sendViaGraph(cfg, msg: OutgoingEmail, deps?: SendDeps): Promise<void>` (107) — the actual transport function (not a returned mailer object). Builds Graph `sendMail` JSON, POSTs to `${GRAPH_BASE}/users/{from}/sendMail`. `OutgoingEmail = {mailbox, to, subject, html, attachment?}`.
- `sendEmailNow(msg, deps?): Promise<boolean>` (160) — sync send bypassing outbox (used for OTP). Returns `false` if unconfigured (line 162, silent no-op), else calls `sendViaGraph` and returns `true`.
- `RateLimitError extends Error` (27) — `constructor(public retryAfterSec: number)`; thrown by `sendViaGraph` on HTTP 429 (144-147), `retryAfterSec` parsed from `Retry-After` header (default 60). Any other non-2xx throws a plain `Error` with `Graph sendMail HTTP {status}: {body.slice(0,300)}` (149-151).
- Token acquisition (`defaultGetToken`, 89) lazy-imports `@azure/identity`; deps are injectable (`SendDeps = {getToken?, fetchImpl?}`) for testing.

## 2. `apps/api/src/services/email-outbox.ts`

- Prisma table `EmailOutbox` (`packages/db/prisma/schema.prisma:790-810`, mapped `email_outbox`): `id` uuid PK, `facilityId Int? @map(facility_id)`, `dedupKey String @unique`, `toAddress String`, `mailbox String`, `templateKind String`, `subject String`, `bodyHtml String`, `attachRef String?`, `status EmailStatus @default(queued)`, `attempts Int @default(0)`, `lastError String?`, `scheduledFor DateTime @default(now())`, `sentAt DateTime?`, `createdAt DateTime @default(now())`. Indexes: `[status,scheduledFor]`, `[facilityId]`. **No transport/provider column exists** — this is exactly where a new `transport` (or similar) column would need to be added for Brevo routing.
- `enqueueEmail<K>(tx, input: EnqueueInput<K>): Promise<boolean>` (57-81). `EnqueueInput = {facilityId?, dedupKey: string, to: string, mailbox: 'notify'|'payroll'|'hr', kind: K, data: TemplatePayloads[K], attachRef?}`. Renders `{subject, html}` via `renderTemplate` at enqueue time (61) and stores them (self-contained row — worker never re-renders). Swallows P2002 unique violation on `dedupKey` → returns `false` (76-79); any other insert error rethrows. Caller warning: after a `false` (collision) return, the tx is poisoned — only COMMIT/ROLLBACK valid.
- `runEmailOutbox(now, deps): Promise<OutboxRunResult>` (115-129) — calls `graphMailerFromEnv()`; if `null`, returns `{sent:0,failed:0,rescheduled:0,disabled:true}` (no-op, no error). Single-instance overlap guard (`workerRunning` boolean, 107) skips a tick if a previous run is still in flight.
- `drainOutbox(cfg, now, deps)` (131-232): claims via `withRls` in one txn — rows where `status='queued' AND scheduledFor<=now` OR `status='sending' AND scheduledFor<=staleBefore` (stuck lease reclaim), `orderBy scheduledFor asc`, `take RATE_PER_RUN=20` (Exchange 30/min cap), flips claimed rows to `status:'sending'` (lease). Sends each row **outside** the DB txn via `sendViaGraph` using the row's stored `mailbox/to/subject/bodyHtml` (no re-render, no template-kind dispatch to different mailers — single hardcoded Graph call, line 166-170). On success: `status:'sent'`, `sentAt`, `lastError:null`, plus `scrubPatch`. On `RateLimitError`: reschedules the failed row AND all remaining still-claimed rows back to `queued` with `scheduledFor = now + retryAfterSec`, no attempt counted, `break`s the batch loop (190-204). On any other error: `attempts++`; if `attempts>=MAX_ATTEMPTS(5)` → terminal `status:'failed'` + scrub; else `status:'queued'`, `scheduledFor = now + backoffMs(attempts)` where `backoffMs = min(2^attempts,30)*60_000` ms (87-90). Every send/fail also writes an audit `logEvent`.
- **Secret-scrubbing**: `SECRET_KINDS = new Set(['otp_login','lms_account_ready'])` (30). `scrubPatch(templateKind)` (31-34) returns `{bodyHtml:''}` only for those two kinds, applied only once a row reaches a **terminal** state (`sent`, or `failed` after max attempts) — non-secret templates keep `bodyHtml` forever (auditable + re-sendable); secret templates are blanked so a plaintext OTP/temp password doesn't linger in the DB post-delivery/post-exhaustion.

## 3. `apps/api/src/services/email-templates.ts`

`EmailTemplateKind` union (5-13), 8 kinds: `payslip_ready`, `account_security_alert`, `parent_meeting`, `otp_login`, `lms_account_ready`, `account_welcome`, `ops_error_alert`, `receipt`.

`renderTemplate<K>(kind, data): RenderedEmail` (263-270) returns `{subject: string, html: string}` — fully generic/transport-agnostic (93-96, 263-270); nothing in the return shape or renderer functions references Graph/mailbox/transport. Templates are wrapped in a shared `layout()` (HTML shell with hardcoded `BRAND` info, inline styles, Vietnamese copy). Confirms: template layer has zero coupling to the Graph transport, so a Brevo transport can consume the same `{subject, html}` output unmodified.

## 4. `enqueueEmail` call sites (recipient data available)

- `apps/api/src/routers/finance.ts:945` (kind `lms_account_ready`) — `to: receipt.parentEmail` (plain email string already on the `Receipt` row; guarded by `if (receipt.parentEmail && lmsAccount)` at 943).
- `apps/api/src/routers/finance.ts:1410` (kind `receipt`, `sendReceiptEmail` mutation) — `to` resolved at 1374-1390: explicit `input.to` (validated `z.string().email()`) → else `receipt.parentEmail` → else a `Guardian`→`ParentAccount.email` lookup scoped to the receipt's facility. Always a plain string by the time `enqueueEmail` is called (throws `BAD_REQUEST` at 1391 if still empty).
- `apps/api/src/routers/payroll.ts:723` (kind `payslip_ready`) — `to: staff.email!`, where `staff` is looked up at line 715 (`tx.appUser.findUnique({where:{id: slip.userId}, select:{email,displayName}})`) — i.e. this call site starts from a `userId` and does its own lookup to get a plain email string before calling `enqueueEmail`.
- `apps/api/src/routers/user.ts:356` (`emailWelcome`, kind `account_welcome`) — `to: email`, a plain string param passed in by the caller (`emailWelcome(email, displayName, primaryRole)`, 353).
- `apps/api/src/routers/user.ts:375` (`emailSecurityAlert`, kind `account_security_alert`) — `to: email`, same pattern, plain string param (372).

Non-router call sites (for completeness, not in `routers/*.ts`): `services/parent-meeting-reminder.ts:64-67` (`to: parent.email`), `services/login-otp.ts:51` (`sendEmailNow`, not `enqueueEmail`, `to: normEmail(email)`), `lib/error-alert.ts:55` (`ops_error_alert` via `enqueueEmail`).

**Conclusion**: at every current call site, `to`/`receipt.parentEmail`/`staff.email` is already a resolved plain email string by the time `enqueueEmail` runs — no call site passes a bare `userId` needing a lookup inside the outbox/template layer. This matters for routing-by-domain: the domain check can be done purely on the `to` string already present in `EnqueueInput`, no additional joins needed in `enqueueEmail` itself.

## 5. Env vars & `STAFF_EMAIL_DOMAIN` usage

`.env.example` Graph/Entra block (lines 78-99): `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ERP_SSO_REDIRECT_URI`, `STAFF_EMAIL_DOMAIN="cmcvn.edu.vn"` (86); then `GRAPH_CLIENT_SECRET`/`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID` (aliases, blank = use `ENTRA_*`), `GRAPH_CERT_PATH`, `GRAPH_CERT_PASSWORD`, `GRAPH_SENDER_NOTIFY/PAYROLL/HR` (97-99).

`STAFF_EMAIL_DOMAIN` references:
- `apps/api/src/lib/sso.ts:25` — read into `SsoConfig.emailDomain` inside `ssoConfigFromEnv()`; SSO is entirely unconfigured (`null`) if unset (26).
- `apps/api/src/lib/sso.ts:31-33` — the actual comparison logic: `emailAllowed(email, domain): boolean { return email.trim().toLowerCase().endsWith(\`@${domain.trim().toLowerCase()}\`); }` — a simple case-insensitive `endsWith('@'+domain)` check, no regex/wildcard/subdomain handling. This is the exact function a Brevo-vs-Graph router could reuse/mirror for "is this recipient internal (staff, @cmcvn.edu.vn) vs external (parent)".
- `docker/docker-compose.prod.yml:100`, `docker-compose.prod.tls.yml:71` — passthrough env wiring.
- `docs/auth-sso-otp-redirection.md:68,136`, `scripts/prod-build-env.sh:52`, `docs/prod-deploy-security-runbook.md:38` — docs/deploy references, same value `cmcvn.edu.vn`.
- `apps/api/test/sso-helpers.test.ts:22` — test sets `process.env.STAFF_EMAIL_DOMAIN = 'cmcvn.edu.vn'`.

Note: `STAFF_EMAIL_DOMAIN` today gates **SSO login** (is this a staff email allowed to SSO-login), not email transport routing — it is not currently read anywhere in `email-outbox.ts` or `graph-client.ts`. A prior brainstorm report (`plans/reports/brainstorm-260702-2352-email-brevo-devops-tier1-report.md:59,90`) already proposes reusing this same var to route Brevo(external)/Graph(internal).

## 6. `docs/decisions/0013-email-microsoft-graph-integration.md` — "Alternatives rejected" (verbatim)

> ## Alternatives rejected
>
> - **SMTP AUTH / SMTP Relay / Direct Send** — Basic Auth deprecation, 30/min cap, IP-static requirement, or internal-only delivery (research §B). Graph fits modern auth + external delivery.

This is the entire section — there is no separate "Alternatives Considered" heading, only this single "Alternatives rejected" section with one bullet. Relevant surrounding context for a new ADR to reference: the Decision states Graph is used via the outbox for `ParentAccount.email` (parents/LMS), `AppUser.email` (staff), `Contact.email` (CRM) recipients (line 22) — i.e. 0013 already sends to external parent addresses via Graph today; a new decision extending 0013 with Brevo-for-external routing would need to explain why Graph-for-parents (already working per 0013 line 22) is being split rather than contradicted — likely on deliverability/reputation grounds for bulk-external parent mail vs. Graph's 30/min-cap + shared-mailbox design intended for internal/low-volume send (0013's own rejected-alternative reasoning about the 30/min cap is directly relevant here).

## Unresolved / for planner

- No `transport` column exists on `EmailOutbox` yet — needs a migration; `drainOutbox` currently makes one hardcoded `sendViaGraph` call per row (line 166-170), so adding Brevo requires branching there.
- `runEmailOutbox` no-ops entirely when Graph is unconfigured (116-119) — need to decide whether a Brevo-only-configured, Graph-unconfigured state should still drain Brevo-routed rows (currently it would not, since the whole worker returns early before per-row transport dispatch).
