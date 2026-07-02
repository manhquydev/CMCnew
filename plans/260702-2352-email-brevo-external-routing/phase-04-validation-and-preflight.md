# Phase 04 — Validation: tests + operator pre-flight + rollout

## Goal

Prove the dual-transport routing works against a real dev Postgres (no mocks for the DB, per repo
convention — the mocked layer is only the outbound `fetch`), wire prod env passthrough, and define
the manual operator pre-flight that must complete BEFORE go-live.

**Depends on phases 1 + 2.**

## Context (test precedent, verified)

- `apps/api/test/email-outbox.int.test.ts` — real Postgres, mocked Graph via injected
  `{ getToken, fetchImpl }`. Has `withoutGraphEnv` (`:17`) + `withGraphEnv` (`:32`) helpers,
  `fetchReturning(status, headers)` (`:10`), global `deleteMany` in `beforeEach`/`afterAll`
  (`:66-71`), `SUPER`/`uniq` from `./helpers.js`.
- `apps/api/test/email-graph-client.test.ts` — pure unit, injected `fetchImpl`, asserts POST URL +
  body shape. Mirror this exactly for Brevo.
- Env passthrough today: `STAFF_EMAIL_DOMAIN` in `docker/docker-compose.prod.yml:100`,
  `docker-compose.prod.tls.yml:71`, `scripts/prod-build-env.sh:52` (scout §5). `BREVO_*` needs the
  same passthrough.

## Files

- CREATE `apps/api/test/brevo-client.test.ts` (unit, mirror `email-graph-client.test.ts`).
- CREATE `apps/api/test/email-routing.test.ts` (unit, pure-function tests for `decideTransport`/`isValidEmailFormat`).
- MODIFY `apps/api/test/email-outbox.int.test.ts` — add routing + no-op-fix + migration-backfill +
  stale-sending-row + per-transport-429-isolation cases + `withBrevoEnv` helper.
- MODIFY (or CREATE if no existing OTP test file) an integration test covering `login-otp.ts`'s
  transport routing (Finding 1).
- MODIFY `docker/docker-compose.prod.yml`, `docker/docker-compose.prod.tls.yml`,
  `scripts/prod-build-env.sh` — pass `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.
- CREATE `docs/brevo-email-preflight-checklist.md` (operator runbook).

## A. Unit tests — `brevo-client.test.ts`, `email-routing.test.ts`

```ts
const CFG = { apiKey: 'xkeysib-x', senderEmail: 'noreply@cmc.local', senderName: 'CMC' };
```
- `brevoMailerFromEnv` returns null when `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` unset (clear both first,
  mirror the graph test's env-save/restore so a configured box is deterministic).
- `sendViaBrevo` on 201: asserts URL `https://api.brevo.com/v3/smtp/email`, header `api-key` present
  (and NOT `Authorization`), body `sender.email`===cfg.senderEmail, `to[0].email`===msg.to,
  `htmlContent`===msg.html.
- 429 → `rejects.toBeInstanceOf(RateLimitError)`, AND `rejects.toThrow(/brevo/)` (regression guard for
  red-team Finding 8 — the message must say "brevo", not the old hardcoded "Graph sendMail...").
- 500 → `rejects.toThrow(/HTTP 500/)`.
- `email-routing.test.ts` (new, pure functions): `decideTransport` staff/external/unset cases;
  `isValidEmailFormat` rejects empty/no-@/leading-or-trailing-@, accepts a normal address.

## B. Integration tests — extend `email-outbox.int.test.ts`

Add a `withBrevoEnv` helper (sets `BREVO_API_KEY`/`BREVO_SENDER_EMAIL`, restores) and a combined
`withBothEnv`. New `enqueue` variant taking a `to` address (current helper hardcodes `a@b.com`).

Cases:
1. **Routing** — enqueue with `to='staff@cmcvn.edu.vn'` (set `STAFF_EMAIL_DOMAIN`), assert row
   `transport==='graph'`; enqueue `to='parent@gmail.com'`, assert `transport==='brevo'`; with
   `STAFF_EMAIL_DOMAIN` unset assert `transport==='graph'`.
2. **No-op fix (the bug)** — enqueue one graph-routed + one brevo-routed row; run with `withBrevoEnv`
   only (Graph unconfigured): brevo row `sent`, graph row still `queued`, `disabled===false`.
3. **Inverse** — `withGraphEnv` only: graph row `sent`, brevo row `queued`.
4. **Both configured** — both rows `sent` in one run.
5. **Both unconfigured** — `disabled===true`, both rows `queued` (regression guard on existing behavior).
6. **Brevo 429** — brevo row returns to `queued` with future `scheduledFor`; a concurrently-claimed
   Graph row in the SAME run is asserted `sent` (not rescheduled) — regression test for the
   per-transport claim split (Finding 5/11 fix; without the split this would fail, since the old
   design rescheduled the whole mixed batch on any 429).
7. **Migration backfill (Finding 2, Critical — most important new test in this phase)** — seed a row
   directly via `tx.emailOutbox.create` with `status:'queued', attempts:2, toAddress:'parent@ext.com'`
   dated BEFORE the transport migration would have run in a real deploy (simulate by inserting with
   an explicit `transport:'graph'` to represent the pre-migration default), then invoke the backfill
   routine directly (import it, don't re-run `prisma migrate` inside a test) and assert: row becomes
   `transport==='brevo'`, `attempts===0`, `lastError===null`.
8. **Stale `sending` row survives a transport config toggle (Finding 13)** — seed a row with
   `status:'sending', transport:'brevo', scheduledFor` older than the stale-lease threshold; run
   `runEmailOutbox` with Brevo unconfigured: assert the row is untouched (still `sending`, not lost,
   not errored) since it's invisible to both claim clauses while `brevo` is absent from `configured`;
   then run again with Brevo configured: assert it gets reclaimed and processed. Document this in the
   test comment as expected/intentional behavior, not an accidental gap.
9. **OTP routing (Finding 1)** — call `requestLoginOtp` (or its underlying send helper directly) with
   a staff email and an external email, mocked `fetchImpl`; assert the staff case hits the Graph
   endpoint URL and the external case hits the Brevo endpoint URL.

Note: the mocked `fetchImpl` is shared across transports in a run; since Graph→202 and Brevo→201
both count as success via `res.ok`, use `fetchReturning(202)` — `res.ok` is true for 201 and 202, so
one mock covers both. For 429 tests, target a single-transport env so only that transport sends,
except case 6 above which deliberately mixes both to prove the isolation fix.

Run: `pnpm --filter @cmc/api test email-outbox` and `... test brevo-client email-routing`. Broaden to
full `pnpm --filter @cmc/api test` since the outbox is shared behavior.

## C. Operator pre-flight checklist (`docs/brevo-email-preflight-checklist.md`)

Manual, outside code scope — **must complete before setting `BREVO_*` in prod**:

1. **Brevo account** — create/confirm account. **Read the ACTUAL limit from the live Brevo dashboard
   for the account/plan being provisioned** (red-team Finding 3, accepted: the research report's "1k
   RPS base plan" figure has no traceable source in its own citations and conflates an API
   rate-limit ceiling with Brevo's actual per-plan DAILY send-volume cap — free tier is a low daily
   count, not 1,000 requests/second). Do not use the research figure to size anything; confirm the
   real number here and size `BREVO_RATE_PER_RUN` (phase-02 §4) against realistic parent-volume
   peaks with headroom, not against an unverified estimate.
2. **Sender address** — add the exact CMCnew sender (e.g. `noreply@cmcvn.edu.vn` or a dedicated
   external sender) in Brevo → Senders. **Per-sender verification is required** (research §3) — the
   old public-website domain verification does NOT carry over.
3. **DNS / DKIM** — publish Brevo's DKIM record + Brevo verification TXT to the sender domain's DNS.
   Confirm SPF alignment; add/confirm DMARC `rua`. Wait for Brevo to show "verified/authenticated".
4. **API key** — generate a fresh transactional API key in Brevo; store as `BREVO_API_KEY` in the
   prod secret store (never commit; `.env.example` stays blank).
5. **Smoke send** — with a temporary key on a staging box, send one email to an external inbox +
   run through mail-tester.com; confirm DKIM=pass, not rewritten to a Brevo-owned from, not spam.
6. **Deploy ordering** — configure + verify Brevo (steps 1-5) BEFORE deploying phase-2 code to prod.
   Until Brevo is live, external rows queue (no loss) but do not deliver. Do not announce until a
   real external send is confirmed.

## D. Rollout & rollback (whole feature)

- **Rollout:** merge phases 1+3 (inert) → apply phase-2 migration (backfills existing rows via
  `decideTransport`, not just a static default — Finding 2) → complete pre-flight C → set `BREVO_*`
  prod env → worker begins draining brevo rows. Watch audit `logEvent` for
  `Đã gửi email ... tới <external>` + Brevo dashboard delivery events.
- **Operator signal (Finding 14, accepted — docs only, no new alerting code built here):** between
  the phase-2 deploy and pre-flight completion (DKIM propagation commonly takes 24-48h), the outbox
  will accumulate `queued` `brevo` rows by design — expected, not a bug. Add a note to the rollout
  runbook: check `SELECT count(*) FROM email_outbox WHERE transport='brevo' AND status='queued'`
  periodically during this window to distinguish "expected pre-launch backlog" from a genuinely
  stuck-row bug (e.g. a Finding-2-class misclassification, or a real Brevo outage after go-live).
  This reuses the existing structured-logging/error-alerting infrastructure already in the codebase
  (`apps/api/src/lib/error-alert.ts`) rather than building new alerting — out of scope for this plan.
- **Rollback:** unset `BREVO_*` → brevo rows return to `queued` (no loss), graph rows unaffected. Full
  code rollback: see phase-02's enforced rollback ordering (pause cron → reclassify → deploy revert →
  resume cron — Finding 6; do NOT redeploy the previous image before running the reclassification SQL).

## Test matrix summary

| Layer | What | Where |
|-------|------|-------|
| Unit | Brevo send POST shape, api-key header, 429/500 mapping incl. transport-labeled message, null config | `brevo-client.test.ts` |
| Unit | `decideTransport`/`isValidEmailFormat` pure-function cases | `email-routing.test.ts` |
| Integration | domain routing, no-op fix (both directions), both/neither configured, per-transport 429 isolation, migration backfill, stale-sending-row survival, OTP routing | `email-outbox.int.test.ts` |
| Manual | sender verification, DKIM pass, real external delivery, real Brevo tier limit confirmed | pre-flight checklist |
| Regression | existing graph-only outbox suite stays green | existing `email-outbox.int.test.ts` cases |

## Risks

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Live `.env` with real `BREVO_*` makes null-path tests non-deterministic | Med×Low | Mirror `withoutGraphEnv` save/clear/restore pattern for BREVO_* keys |
| Global outbox drain crowds routing assertions | Low×Med | Reuse existing `beforeEach deleteMany({})` + unique dedup prefix |
| Prod env passthrough forgotten → Brevo silently unconfigured in prod | Med×High | Checklist step + compose/prod-build-env edits tracked as phase-4 files |
| Pre-flight checklist's unsourced-RPS-figure gap silently reintroduced by a future editor | Low×Med | §C.1 above now explicitly forbids citing the research doc's figure; requires reading the live dashboard |

## Done = observable

- `brevo-client.test.ts` + `email-routing.test.ts` + new `email-outbox.int.test.ts` cases (including
  the migration-backfill and OTP-routing cases) green against live Postgres.
- Full `pnpm --filter @cmc/api test` green; typecheck + lint clean.
- `BREVO_*` present in both compose files + `prod-build-env.sh`.
- Pre-flight checklist doc exists, is executable by an operator without code knowledge, and states
  the real (dashboard-confirmed) Brevo volume limit — not the unsourced research-report figure.
