# Phase 02 — Outbox schema + domain routing + drain branch + no-op fix

## Goal

Add a `transport` column to `EmailOutbox`, decide transport at `enqueueEmail` time from the recipient
domain, branch `drainOutbox` per-row, fix the worker-wide no-op so a Brevo-only configuration still
drains Brevo rows, **and fix the parent-facing OTP login path** (which bypasses the outbox entirely
and was missed by the original phase design — red-team Finding 1, Critical).

**Depends on phase 1** (imports `sendViaBrevo`, `brevoMailerFromEnv`, `decideTransport`,
`isValidEmailFormat` from the phase-1 files; `RateLimitError`'s new `transport` param).

## Context (verified)

- Schema `EmailOutbox`: `packages/db/prisma/schema.prisma:790-810` — no transport column today.
  Existing enum pattern: `EmailStatus` (used at `:800`).
- Outbox service `apps/api/src/services/email-outbox.ts`:
  - `enqueueEmail` insert `:62-74` — where the `transport` value is set.
  - `runEmailOutbox` `:115-129` — gates the WHOLE worker on `graphMailerFromEnv()` null (`:116-119`).
    **This is the bug.**
  - `drainOutbox` claim query `:138-156`; single hardcoded `sendViaGraph` call `:166-170`;
    `RATE_PER_RUN = 20` constant (`:22`, sized for Exchange's 30/min cap — see Finding 5 below).
- Routing logic to mirror: `apps/api/src/lib/sso.ts:31-33` `emailAllowed(email, domain)` =
  `email.trim().toLowerCase().endsWith('@'+domain.trim().toLowerCase())`. `STAFF_EMAIL_DOMAIN` =
  `cmcvn.edu.vn` in prod (scout §5). `decideTransport` (phase 1, `email-routing.ts`) mirrors this
  same comparison but is NOT imported from `sso.ts` — that function is semantically "allowed to
  SSO-login", a different intent (DRY of logic, not of import).
- **OTP bypass (Finding 1):** `apps/api/src/services/login-otp.ts:8,51` — `requestLoginOtp` calls
  `sendEmailNow({mailbox:'notify', to: normEmail(email), subject, html}, deps)` from
  `graph-client.ts`, which POSTs directly via `sendViaGraph` — never touches `enqueueEmail`/
  `drainOutbox`. Parents are external recipients by definition, so without a fix here the parent LMS
  login OTP — the single most latency- and trust-sensitive external email in the product — would
  stay on the broken `550 5.7.708` Graph path even after this whole plan ships elsewhere.

## Files

- MODIFY `packages/db/prisma/schema.prisma` — add `transport` + `EmailTransport` enum.
- CREATE migration dir `packages/db/prisma/migrations/<timestamp>_email_outbox_transport/migration.sql`
  (generate via `pnpm --filter @cmc/db prisma migrate dev --name email_outbox_transport`) — includes a
  **data backfill**, not just the column add (see Finding 2 below).
- MODIFY `apps/api/src/services/email-outbox.ts`.
- MODIFY `apps/api/src/services/login-otp.ts` — route the OTP send through `decideTransport` (Finding 1).

## Implementation

### 1. Schema

```prisma
enum EmailTransport {
  graph
  brevo
}

model EmailOutbox {
  // ...existing fields...
  transport    EmailTransport @default(graph)
  // ...
}
```

Generated migration must produce (verify the SQL, do not hand-write the enum name wrong):
```sql
CREATE TYPE "EmailTransport" AS ENUM ('graph', 'brevo');
ALTER TABLE "email_outbox" ADD COLUMN "transport" "EmailTransport" NOT NULL DEFAULT 'graph';
```
`DEFAULT 'graph'` alone is **not sufficient** — red-team Finding 2 (Critical, accepted): a row
already `queued`/`sending` at migration time with `attempts > 0` is, by construction, a row that has
ALREADY failed against Graph for the exact `550 5.7.708` reason this plan exists to fix. Leaving it
pinned to `transport='graph'` means the worker keeps retrying the same broken path until
`MAX_ATTEMPTS` (5), at which point `drainOutbox` marks it `failed` AND `scrubPatch` blanks
`bodyHtml` for `SECRET_KINDS` rows (`otp_login`, `lms_account_ready` — both are parent-facing per
`login-otp.ts:45` and `finance.ts:944-951`) — an OTP code or temp password is then unrecoverably
gone, even after Brevo goes live, because nothing ever re-evaluates `transport` for that row.

**Fix: add a data-backfill step to the SAME migration**, re-running the domain split against every
row still in a non-terminal state:
```sql
UPDATE "email_outbox"
SET "transport" = 'brevo'
WHERE "status" IN ('queued', 'sending')
  AND lower("to_address") NOT LIKE '%@' || lower(current_setting('app.staff_email_domain', true));
```
This repo's migrations don't have a `current_setting`-based env passthrough today — simplest correct
approach is to NOT rely on a runtime GUC in the migration SQL at all. Instead, do the reclassification
in application code, not raw SQL: add a one-off backfill call inside the SAME deploy step (a small
script or a `postinstall`/migration-adjacent TS script using `decideTransport` from phase 1, run once
against all `status IN ('queued','sending')` rows) so the exact same routing logic used at enqueue
time is reused for the backfill — avoids duplicating the `STAFF_EMAIL_DOMAIN` comparison in two
places (SQL string-match vs `decideTransport`'s TS logic) and reduces drift risk. Also reset
`attempts = 0` and `lastError = NULL` for any row being reclassified from `graph`→`brevo`, so it gets
a fresh backoff window on the newly-correct transport rather than inheriting a stale attempt count
from the broken path.

Consider an index only if drain-filtering by transport shows up in query plans — the existing
`@@index([status, scheduledFor])` already covers the claim; a composite is premature (YAGNI). Decide
during phase-04 test run.

### 2. `enqueueEmail` — decide transport

Import from phase 1's shared module instead of a local helper (moved out so `login-otp.ts` — Finding
1, section 5 below — can reuse the exact same decision function):
```ts
import { decideTransport, isValidEmailFormat } from '../lib/email-routing.js';
```
In `enqueueEmail`, before the `tx.emailOutbox.create` call, add the cheap format guard (Finding 7,
accepted — fails fast instead of burning a 5-attempt retry cycle on an obviously-malformed address):
```ts
if (!isValidEmailFormat(input.to)) {
  throw new Error(`enqueueEmail: malformed recipient address "${input.to}"`);
}
```
In the `tx.emailOutbox.create` data (`:64-73`) add: `transport: decideTransport(input.to),`.
`mailbox` is still stored (Graph rows need it; Brevo ignores it — leave as-is, no schema change to
mailbox). No change to `EnqueueInput` — callers already pass a resolved `to` string (scout §4).

**Accepted risk (Finding 9, documented not fixed):** `decideTransport` treats "not
`@STAFF_EMAIL_DOMAIN`" as synonymous with "external/parent," but `apps/api/src/routers/user.ts:83`
validates a new staff account's email only with `z.string().email()` — there's no server-side check
that it matches `STAFF_EMAIL_DOMAIN` at account-creation time (only at SSO login, via
`sso.ts:25-33`). A staff account created with a non-`cmcvn.edu.vn` address (data-entry error, or a
contractor onboarded before their M365 mailbox exists) would have `account_security_alert`/
`payslip_ready`/`account_welcome` silently routed through Brevo instead of Graph. **Decision:** not
fixing this in this plan — adding domain enforcement at `user.create` is a separate concern
(account-provisioning validation, not email transport). Record as an accepted risk in decision 0029
(see phase 3) rather than adding new validation here, to avoid scope creep beyond what's needed to
fix the `550 5.7.708` external-delivery problem.

### 3. `runEmailOutbox` — resolve both configs, fix the no-op

```ts
export async function runEmailOutbox(now = new Date(), deps: SendDeps = {}): Promise<OutboxRunResult> {
  const graphCfg = graphMailerFromEnv();
  const brevoCfg = brevoMailerFromEnv();
  if (!graphCfg && !brevoCfg) {
    return { sent: 0, failed: 0, rescheduled: 0, disabled: true }; // BOTH unconfigured → no-op
  }
  if (workerRunning) return { sent: 0, failed: 0, rescheduled: 0, disabled: false, skipped: true };
  workerRunning = true;
  try {
    return await drainOutbox(graphCfg, brevoCfg, now, deps);
  } finally {
    workerRunning = false;
  }
}
```

### 4. `drainOutbox` — claim only configured transports, branch per row, split the rate cap

- Signature → `drainOutbox(graphCfg: GraphMailerConfig | null, brevoCfg: BrevoMailerConfig | null, now, deps)`.
- **Rate cap split (Finding 5, accepted):** `RATE_PER_RUN = 20` (`email-outbox.ts:22`) was sized
  specifically for Exchange's 30/min cap and is a single shared ceiling across a `findMany` that will
  now mix both transports. `parent-meeting-reminder.ts:61-74` enqueues one Brevo-routed row per
  notifiable parent per meeting per class in a tight loop — a burst there can starve internal Graph
  mail of its slice of the shared 20-row window, or vice versa, even though the two transports have
  independent real capacity. Split into two per-transport constants and claim/send each transport's
  slice separately:
```ts
const GRAPH_RATE_PER_RUN = 20;  // unchanged — Exchange's 30/min cap, keep headroom
const BREVO_RATE_PER_RUN = 20;  // starting value; raise once phase-04's pre-flight confirms the
                                 // actual provisioned Brevo tier's real limit (do NOT assume 1k RPS
                                 // — see phase 4 Finding 3, that figure was unsourced)
```
- Build the configured list and run the claim+send per transport (two smaller claims instead of one
  mixed claim) so a rate-limit on one transport can never reschedule the other transport's
  in-flight batch (Finding 11, accepted — was rated `Low×Low` in the original risk table without
  accounting for two independently-limited external services sharing one batch):
```ts
const configured: ('graph' | 'brevo')[] = [];
if (graphCfg) configured.push('graph');
if (brevoCfg) configured.push('brevo');

for (const transport of configured) {
  const take = transport === 'graph' ? GRAPH_RATE_PER_RUN : BREVO_RATE_PER_RUN;
  const claimed = await tx.emailOutbox.findMany({
    where: {
      transport,
      OR: [
        { status: 'queued', scheduledFor: { lte: now } },
        { status: 'sending', scheduledFor: { lte: staleBefore } },
      ],
    },
    orderBy: { scheduledFor: 'asc' },
    take,
  });
  // ...flip claimed to 'sending' (unchanged lease logic), then send loop below, PER transport —
  // a RateLimitError in the graph loop no longer touches brevo's already-claimed rows and vice versa.
}
```
- Send-loop branch (per claimed row, inside the per-transport loop above):
```ts
const msg = { mailbox: row.mailbox, to: row.toAddress, subject: row.subject, html: row.bodyHtml };
if (transport === 'brevo') await sendViaBrevo(brevoCfg!, msg, deps);
else await sendViaGraph(graphCfg!, msg, deps);
```
`!` is justified: the outer loop only runs for transports in `configured`, so the matching cfg is
guaranteed non-null.
- Add the import: `import { brevoMailerFromEnv, sendViaBrevo, type BrevoMailerConfig } from '../lib/brevo-client.js';`
- 429 / attempt / backoff / scrub logic (`:190-228`) is UNCHANGED in shape, just now scoped to one
  transport's claimed batch per the split above — `RateLimitError` is thrown by both transports (now
  carrying a `transport` label per phase 1 Finding 8), so the existing `instanceof RateLimitError`
  branch handles Brevo too, and only reschedules that transport's remaining claimed rows.

### 5. `login-otp.ts` — route the OTP send (Finding 1, Critical, accepted)

`requestLoginOtp` currently calls `sendEmailNow` directly (`login-otp.ts:51`), bypassing the outbox
entirely — a deliberate design choice per the existing code comment at `:49-50` ("Fire the Graph
send WITHOUT blocking the response... shrinking the timing side-channel"). The fix preserves that
synchronous, non-blocking shape (do NOT force OTP through the outbox — that would reintroduce the
timing side-channel the original code explicitly avoided) but adds transport routing inline:

```ts
// login-otp.ts — replace the sendEmailNow(...) call
import { decideTransport } from '../lib/email-routing.js';
import { graphMailerFromEnv, sendViaGraph } from '../lib/graph-client.js';
import { brevoMailerFromEnv, sendViaBrevo } from '../lib/brevo-client.js';

// ...inside requestLoginOtp, replacing the existing `void sendEmailNow(...)` line:
const to = normEmail(email);
const msg = { mailbox: 'notify' as const, to, subject, html };
const transport = decideTransport(to);
if (transport === 'brevo') {
  const cfg = brevoMailerFromEnv();
  if (cfg) void sendViaBrevo(cfg, msg, deps).catch((e) => logger.error({ err: e }, 'brevo OTP send failed'));
} else {
  const cfg = graphMailerFromEnv();
  if (cfg) void sendViaGraph(cfg, msg, deps).catch((e) => logger.error({ err: e }, 'graph OTP send failed'));
}
```

No fallback between transports (consistent with the outbox's own "no fallback of external mail back
to Graph" scope decision — plan.md "Out of scope"): if the decided transport isn't configured, the
OTP send is skipped, matching `sendEmailNow`'s existing no-op-when-unconfigured behavior (today's
status quo when Graph itself is unconfigured). This does NOT add a new failure mode — it's the same
"skip silently if unconfigured" behavior `sendEmailNow` already has, just transport-aware now.

## Data flow

`enqueueEmail(to,...)` → `decideTransport(to)` → INSERT row `{transport,...}` → worker tick →
`runEmailOutbox` resolves `graphCfg`+`brevoCfg` → `drainOutbox` claims rows per-transport (§4) →
`sendViaBrevo|sendViaGraph` → 201/202 sent | 429 reschedule same-transport batch | other backoff/fail.

`requestLoginOtp(email)` → `decideTransport(to)` → `sendViaBrevo|sendViaGraph` directly (no outbox,
unchanged synchronous fire-and-forget shape).

## Backwards compatibility

- Existing rows → `transport='brevo'` (reclassified) or `'graph'` (unchanged) via the migration
  backfill (§1, Finding 2) — in-flight rows get corrected, not silently pinned to the broken path.
- `STAFF_EMAIL_DOMAIN` unset → every row (new and backfilled) stays `graph` → identical to today.
- Graph configured + Brevo not → external (brevo) rows queue harmlessly until Brevo configured. This
  is INTENTIONAL: Graph-external is the broken `550` path, so queuing beats delivering-to-a-blackhole.
  Deploy ordering (phase 4 pre-flight) ensures Brevo is live first. OTP is the one exception — it has
  no queue, so an OTP request during the Brevo-not-yet-configured window is silently skipped, same as
  today's status quo (Graph OTP already silently fails against the `550` block for external
  recipients — this plan does not make that specific window worse, it only makes it recoverable once
  Brevo is configured).

## Test matrix (implemented phase 4)

- Routing: staff `@cmcvn.edu.vn` → `graph`; `parent@gmail.com` → `brevo`; `STAFF_EMAIL_DOMAIN` unset → `graph`.
- No-op fix: Brevo-only env → brevo rows `sent`, graph rows remain `queued`. Graph-only → inverse.
- Both configured → both drain. Both unconfigured → `disabled:true`.
- Brevo 429 → row back to `queued` with future `scheduledFor`; unrelated Graph-transport rows in the
  same tick are NOT rescheduled (regression test for the Finding-11 per-transport claim split).
- Migration backfill: seed a `queued`/`attempts>0` row with an external `to` BEFORE running the
  migration in the test, assert it becomes `transport='brevo'` with `attempts` reset to 0 after
  (Finding 2 regression test — this is the single most important new test in this phase).
- OTP routing: `requestLoginOtp` with a mocked `decideTransport` result calls `sendViaBrevo` for an
  external recipient and `sendViaGraph` for a staff recipient (Finding 1 regression test).

## Risks

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Claim query filters out ALL rows when `configured` empty | Low×High | Guarded upstream: `runEmailOutbox` returns `disabled` before drain when both null |
| `decideTransport` misclassifies subdomain (e.g. `x@sub.cmcvn.edu.vn`) | Low×Med | Same `endsWith('@'+domain)` semantics as SSO — accepted, matches existing login gate |
| Enum migration fails on prod drift | Low×High | Generate via `prisma migrate dev`; verify 0-drift (repo runbook: 54/54 clean) before merge |
| Migration backfill misclassifies an in-flight row | Low×High | Reuses the exact same `decideTransport` function as enqueue-time routing — no separate SQL-string comparison to drift from the TS logic (Finding 2 fix) |
| A staff account with a non-`STAFF_EMAIL_DOMAIN` email gets routed through Brevo | Low×Med | Accepted risk, documented in decision 0029, not fixed here — see Finding 9 note in §2 (out of scope: account-creation domain validation is a separate concern) |
| `attachRef` appears Brevo-specific but is dead code on Graph too | — (docs only) | Corrected in phase 1's Notes and this plan: `attachRef`/`msg.attachment` is unimplemented for BOTH transports today, a pre-existing gap not introduced by this plan (Finding 10) |

Note on the retired "mixed-transport batch" risk row: the per-transport claim/send split in §4
(Finding 5/11 fix) eliminates this risk at the design level — a Brevo 429 can no longer reschedule
Graph rows in the same tick because they're no longer claimed in the same batch. No longer listed as
an accepted risk; it's fixed.

## Rollback

**Enforced ordering (Finding 6, accepted — replaces the original ad hoc "before reverting" note,
which described the right intent but not an enforceable sequence).** A standard incident-response
reflex ("redeploy the previous image first, investigate DB after") would otherwise let the reverted,
transport-blind `drainOutbox` re-drive Brevo-tagged rows through the broken Graph path on the very
next cron tick, before any manual SQL mitigation runs. Rollback MUST follow this order, as a
numbered runbook step in phase-04's rollout/rollback section (not an aside here):

1. **Pause the outbox cron trigger first** (disable the `cron.schedule` call in `index.ts`, or scale
   the API worker to 0) — before touching code or data. This is the step the original note omitted.
2. Run the reclassification SQL: `UPDATE email_outbox SET status='failed' WHERE transport='brevo' AND
   status IN ('queued','sending')` (recommended default — see below for why, not "leave queued").
3. Only then deploy the code revert.
4. Re-enable the cron.

**Default action for step 2 (Finding 6, resolving the original either/or):** mark affected rows
`failed`, not "leave queued indefinitely." The plan's own stated rollback principle elsewhere
(`BREVO_*` unset case) is "no loss, requeue" — but that's for the *forward* no-op case where Brevo
config is simply absent. A rollback-of-code scenario is different: after the code revert, nothing
in the codebase knows about the `transport` column anymore, so a `queued` brevo row would sit
invisible forever with no worker capable of ever reclaiming it correctly. `failed` is honest and
visible; leaving it silently queued is not. Down-migration (`DROP COLUMN transport; DROP TYPE
"EmailTransport";`) only after no brevo rows remain.

**Follow-up, not blocking this plan (Finding 12, accepted as a DEBT.md item, not a new phase-4
requirement):** `decideTransport` is a one-time enqueue-time decision with no operator-facing
reclassification tool for any FUTURE `STAFF_EMAIL_DOMAIN` policy change (distinct from the
migration-time backfill in §1, which this plan does cover). Record a DEBT.md entry: "no admin/CLI
command exists to re-route already-enqueued outbox rows if the staff/external domain split changes
after go-live" — not needed for this plan's actual problem (fixing `550 5.7.708`), but worth tracking
so a future operator doesn't have to invent one at incident time.

## Done = observable

- Migration applies with 0 drift; `prisma migrate status` clean.
- Migration backfill correctly reclassifies a seeded in-flight external row (Finding 2 test, phase 4).
- Phase-4 integration tests green (routing + no-op-fix + OTP + per-transport rate-limit isolation cases).
- `pnpm --filter @cmc/api typecheck` + lint clean.
