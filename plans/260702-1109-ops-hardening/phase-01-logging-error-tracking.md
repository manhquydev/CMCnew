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
- Alerting has zero new infra cost by reusing `enqueueEmail` (DRY). dedupKey `error_alert:<yyyy-mm-dd-hh>` collapses
  a storm into one mail per window (idempotent via the existing P2002 swallow at `email-outbox.ts:70-74`).
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
            │     └─ if window count ≥ threshold ─► withRls(SYSTEM_CTX, tx => enqueueEmail(tx, {dedupKey}))
            └─ (optional) Sentry.captureException(err)  // no-op unless SENTRY_DSN set
```

## Related code files
- MODIFY `apps/api/src/index.ts` — add logger import, `app.onError`, swap bootstrap `console.*`
- CREATE `apps/api/src/lib/logger.ts` — pino instance + level/env config
- CREATE `apps/api/src/lib/error-alert.ts` — rolling window counter + `maybeAlert()` using `enqueueEmail`
- MODIFY `apps/api/package.json` — add `pino` (+ `pino-pretty` dev), optionally `@sentry/node`

## Implementation Steps
1. Add deps to `apps/api/package.json`; `pnpm install`.
2. `logger.ts`: export a configured pino instance (JSON in prod, pretty transport in dev, level from `LOG_LEVEL`).
3. `error-alert.ts`: module-level ring/counter keyed by minute; `recordError()` + `maybeAlert(logger)` that
   enqueues via `withRls(SYSTEM_CTX, tx => enqueueEmail(...))` with dedupKey `error_alert:<window>`; guard so the
   alert path never throws into the error handler.
4. `index.ts`: register `app.onError((err, c) => { logger.error(...); recordError(); void maybeAlert(); return c.json(...,500) })`.
5. (Optional) init Sentry behind `if (process.env.SENTRY_DSN)`; keep import lazy so unset = zero cost.
6. Add the new env vars to `.env.example` — coordinate with P5 (P5 owns the file; P1 supplies the names/comments).

## Todo list
- [ ] Add pino (+ optional sentry) deps
- [ ] logger.ts
- [ ] error-alert.ts (singleton counter + dedup'd outbox alert)
- [ ] Wire app.onError + swap bootstrap console.*
- [ ] Env names handed to P5: LOG_LEVEL, ERROR_ALERT_THRESHOLD, (optional) SENTRY_DSN
- [ ] typecheck + lint + `pnpm --filter @cmc/api test:integration`

## Success Criteria
- Boot logs are structured JSON in production mode.
- A thrown handler error is logged with method/path and returns a 500 JSON envelope.
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
