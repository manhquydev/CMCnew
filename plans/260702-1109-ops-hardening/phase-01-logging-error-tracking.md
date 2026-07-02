# Phase 1 — Structured logging + error tracking + basic alerting

## Context links
- Report §"PLAN 7" item 1: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md:43`
- Entry point: `apps/api/src/index.ts:27-54` (Hono app + `/health`, no logger today)
- Reuse target: `apps/api/src/services/email-outbox.ts` (`enqueueEmail`, dedupKey idempotency, no-op when Graph unset)
- Single-instance caveat precedent: `email-outbox.ts:96-100`, `apps/api/src/rate-limit.ts`

## Overview
Today `apps/api/src` has zero structured logging or error tracking — only `console` + the `/health` marker
(`index.ts:48-54`). Add: (a) pino as the process logger, (b) a Hono error boundary that logs + counts errors,
(c) a threshold alert that enqueues one dedup'd email via the existing outbox. Optionally wire an env-gated
Sentry SaaS SDK that stays a no-op until `SENTRY_DSN` is set (mirrors the codebase's "inert until env" pattern).

## Key Insights
- Codebase convention is **inert-until-env** (email-outbox no-op without `GRAPH_*`, SSO off without `ENTRA_*`).
  Error tracking should follow the same shape: `SENTRY_DSN` unset → SDK not initialized, no behavior change.
- Alerting reuses the `enqueueEmail` **public API** (`email-outbox.ts:52`, exported; `enqueueEmail<K extends
  EmailTemplateKind>(tx, input)`) — no new infra (SMTP/queue), but it is **NOT zero new code**: `EmailTemplateKind`
  (`email-templates.ts:5-11`) is a closed union with no ops/error-alert kind, and `renderTemplate` switches on it
  exhaustively. A new kind (`ops_error_alert`) + its `TemplatePayloads` entry + a renderer branch must be added to
  `email-templates.ts`. Reusing `account_security_alert` would be semantic misuse (its payload is a single-account
  event, not an error-rate window). dedupKey `ops_error_alert:<yyyy-mm-dd-hh>` collapses a storm into one mail per
  window (idempotent via the existing P2002 swallow at `email-outbox.ts:70-74`).
- `SYSTEM_CTX` (`email-outbox.ts:20`) is **not exported** — a module-private const. `error-alert.ts` must define its
  own trivial system context literal (`{ facilityIds: [], isSuperAdmin: true }`) for its `withRls` call rather than
  importing `SYSTEM_CTX`. (Do NOT add an export to `email-outbox.ts` — a 1-line literal keeps the file-ownership
  boundary clean.)
- Error-rate counter is **process-local state** — must be a module singleton, correct only for the single-API-instance
  topology (same caveat already documented for the outbox worker and rate-limiter). Do not add per-request state.

## Requirements
- pino logger initialized once; log level from `LOG_LEVEL` (default `info`), pretty only in non-production.
- Hono `app.onError` boundary: log the error with request context (method, path, status), increment the counter.
- Rolling window counter (e.g. errors in the last 5 min); when it crosses `ERROR_ALERT_THRESHOLD` (default e.g. 10),
  enqueue one alert email to `GRAPH_SENDER_NOTIFY` mailbox with a window dedupKey.
- Error-tracker decision (see Unresolved in plan.md): recommend env-gated Sentry SaaS SDK, no-op when `SENTRY_DSN` unset.
- Replace ad-hoc `console.*` in `index.ts` cron/bootstrap paths with the pino logger where it clarifies ops output.

## Architecture
```
request ──► Hono handler ──► throws
                 │
                 ▼
          app.onError (new)
            ├─ logger.error({ method, path, err })   (pino → stdout, JSON in prod)
            ├─ errorCounter.record(now)               (module singleton)
            │     └─ if window count ≥ threshold ─► withRls(sysCtx, tx => enqueueEmail(tx, {kind:'ops_error_alert', dedupKey}))
            │            // sysCtx = local literal { facilityIds: [], isSuperAdmin: true } — SYSTEM_CTX is not exported
            └─ (optional) Sentry.captureException(err)  // no-op unless SENTRY_DSN set
```

## Related code files
- MODIFY `apps/api/src/index.ts` — add logger import, `app.onError`, swap bootstrap `console.*`
- CREATE `apps/api/src/lib/logger.ts` — pino instance + level/env config
- CREATE `apps/api/src/lib/error-alert.ts` — rolling window counter + `maybeAlert()` calling `enqueueEmail` via a local system-context literal
- MODIFY `apps/api/src/services/email-templates.ts` — add `ops_error_alert` to `EmailTemplateKind`, a `TemplatePayloads` entry (e.g. `{ windowStart: string; count: number; threshold: number }`), and a renderer branch (keeps the exhaustive `renderTemplate` switch complete)
- MODIFY `apps/api/package.json` — add `pino` (+ `pino-pretty` dev), optionally `@sentry/node`

## Implementation Steps
1. Add deps to `apps/api/package.json`; `pnpm install`.
2. `logger.ts`: export a configured pino instance (JSON in prod, pretty transport in dev, level from `LOG_LEVEL`).
3. Add the `ops_error_alert` kind + payload + renderer to `email-templates.ts` (so `enqueueEmail` type-checks and the
   `renderTemplate` switch stays exhaustive).
4. `error-alert.ts`: module-level ring/counter keyed by minute; `recordError()` + `maybeAlert(logger)` that enqueues
   via `withRls(sysCtx, tx => enqueueEmail(tx, { kind: 'ops_error_alert', dedupKey, data }))` (local `sysCtx` literal,
   NOT the private `SYSTEM_CTX`) with dedupKey `ops_error_alert:<window>`; guard so the alert path never throws into
   the error handler.
5. `index.ts`: register `app.onError((err, c) => { logger.error(...); recordError(); void maybeAlert(); return c.json(...,500) })`.
6. (Optional) init Sentry behind `if (process.env.SENTRY_DSN)`; keep import lazy so unset = zero cost.
7. Add the new env vars to `.env.example` — coordinate with P5 (P5 owns the file; P1 supplies the names/comments).

## Todo list
- [x] Add pino (+ pino-pretty dev) deps — Sentry dropped per operator decision (2026-07-02: no PII egress, pino+email only)
- [x] logger.ts
- [x] email-templates.ts: add `ops_error_alert` kind + payload + renderer
- [x] error-alert.ts (singleton counter + dedup'd outbox alert via local sysCtx literal)
- [x] Wire app.onError + swap bootstrap console.*
- [x] Env names handed to P5: LOG_LEVEL, ERROR_ALERT_THRESHOLD, OPS_ALERT_EMAIL (SENTRY_DSN dropped)
- [x] typecheck + lint + `pnpm --filter @cmc/api test:integration` — 410/410 int-tests, 0 typecheck/lint errors

## Success Criteria
- Boot logs are structured JSON in production mode.
- A thrown handler error is logged with method/path and returns a 500 JSON envelope.
- `email-templates.ts` compiles with the new `ops_error_alert` kind; `renderTemplate` handles it (exhaustive switch).
- Crossing the threshold enqueues exactly one `emailOutbox` row per window (verified by integration test with a mock sender; reuse `email-outbox.int.test.ts` harness).
- With `SENTRY_DSN` unset, no Sentry network calls occur.

## Risk Assessment
- **Alert path throwing inside onError (MED×HIGH):** wrap `maybeAlert` in try/catch + `void`; never let alerting mask the original error. Mitigation baked into step 3.
- **Log volume / PII (LOW×MED):** do not log request bodies or cookies; log only method/path/status/errmsg. pino redaction paths for any header logging.
- **Under-count on multi-replica (LOW):** documented single-instance limitation; acceptable at current topology.

## Security Considerations
- Never log `JWT_SECRET`, cookies, passwords, OTP, or email bodies. Alert email contains counts + error class only, no PII.
- If Sentry SaaS is enabled later, scrub PII before send (student data) — gate behind explicit operator decision (plan.md Unresolved).

## Next steps
- Feeds go-live criterion 4 ("lỗi prod có alert"). After merge, operator sets `LOG_LEVEL`/threshold in `.env.production`.
