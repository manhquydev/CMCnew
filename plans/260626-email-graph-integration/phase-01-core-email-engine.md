# Phase 01 — Core email engine

**Goal:** A working, testable email pipeline that does nothing observable until Microsoft config
is present. Foundation for all other phases. No business triggers wired yet.

## Context

- Mirror `apps/api/src/lib/callio-client.ts`: env→config loader returns `null` when unset; the
  caller treats `null` as a clean no-op (never throws).
- Cron lives in `apps/api/src/index.ts` (see `DISABLE_CRON` guard, lines 256–274). Add the email
  worker tick there.
- DB access uses `withRls`; the worker has no session → use the `SYSTEM_CTX` super-bypass pattern
  from `services/parent-meeting-reminder.ts` (`{ facilityIds: [], isSuperAdmin: true }`).
- Audit via `logEvent` from `@cmc/audit`.

## Files to create

| File | Responsibility |
|------|----------------|
| `packages/db/prisma/schema.prisma` (edit) | new `EmailOutbox` model + `EmailStatus` enum |
| `packages/db/prisma/migrations/<ts>_email_outbox/migration.sql` | table + indexes + RLS policy |
| `apps/api/src/lib/graph-client.ts` | Graph auth + `sendMail` (network half), env loader, no-op |
| `apps/api/src/services/email-outbox.ts` | `enqueueEmail(tx, …)`, `runEmailOutbox()` worker (pure-ish + network) |
| `apps/api/src/services/email-templates.ts` | `renderTemplate(kind, data) → { subject, html }` |
| `apps/api/test/email-outbox.int.test.ts` | worker/idempotency/backoff/no-op tests (mock Graph) |
| `.env.example` (edit) + `.env.production.example` (edit) | document all `GRAPH_*` vars |
| `apps/api/package.json` (edit) | add `@azure/identity`, `@microsoft/microsoft-graph-client` |

## Data model

```prisma
enum EmailStatus { queued sending sent failed skipped }

/// Outbox cho email gửi qua Microsoft Graph. Worker (cron) rút hàng đợi, render & gửi.
/// Idempotent qua dedupKey. System-scoped (worker chạy super-bypass) — facilityId chỉ để truy vết.
model EmailOutbox {
  id           String      @id @default(uuid()) @db.Uuid
  facilityId   Int?        @map("facility_id")
  dedupKey     String      @unique @map("dedup_key")   // e.g. "payslip_ready:<payslipId>"
  toAddress    String      @map("to_address")
  mailbox      String                                   // sender shared-mailbox key: notify|payroll|hr
  templateKind String      @map("template_kind")
  subject      String
  bodyHtml     String      @map("body_html")
  attachRef    String?     @map("attach_ref")           // optional pdf-store ref (Phase 03)
  status       EmailStatus @default(queued)
  attempts     Int         @default(0)
  lastError    String?     @map("last_error")
  scheduledFor DateTime    @default(now()) @map("scheduled_for")
  sentAt       DateTime?   @map("sent_at")
  createdAt    DateTime    @default(now()) @map("created_at")

  @@index([status, scheduledFor])
  @@map("email_outbox")
}
```

RLS: enable RLS; the runtime role `cmc_app` gets a policy allowing all rows only when the
super-bypass GUC is set (match the existing system-table convention — copy the policy shape used
by `notification`/system tables in the prior `*_data_integrity_constraints` migration). The worker
runs under `SYSTEM_CTX`, so it sees all rows; no normal principal can read the outbox.

## graph-client.ts (contract)

```ts
export interface GraphMailerConfig {
  tenantId: string; clientId: string;
  certPath: string; certPasswordEnv?: string;   // PEM/PFX on disk; never inline the key
  senders: Record<'notify'|'payroll'|'hr', string>; // mailbox key → from-address
}
export function graphMailerFromEnv(): GraphMailerConfig | null; // null when unconfigured → no-op
export interface OutgoingEmail { from: string; to: string; subject: string; html: string;
  attachment?: { name: string; contentType: string; bytes: Buffer } }
export async function sendViaGraph(cfg: GraphMailerConfig, msg: OutgoingEmail,
  deps?: { credentialFactory?: …; fetchImpl?: typeof fetch }): Promise<void>; // throws on non-2xx; 429 → typed RateLimitError
```

- Auth: `@azure/identity` `ClientCertificateCredential(tenantId, clientId, { certificatePath })`,
  scope `https://graph.microsoft.com/.default` (client-credentials flow). Wrap with
  `@microsoft/microsoft-graph-client` `TokenCredentialAuthenticationProvider`.
- Send: `POST /users/{from}/sendMail` with `saveToSentItems:false` (research §H.3 — keep shared
  mailbox small; retention handled MS-side). Map HTTP 429 → `RateLimitError(retryAfterSec)`.
- **Verify SDK package names/versions with context7 at implement time** (Graph SDK evolves).

## email-outbox.ts (contract)

- `enqueueEmail(tx, { facilityId?, dedupKey, to, mailbox, templateKind, data, attachRef? })`:
  renders subject/html via `email-templates`, inserts an `EmailOutbox` row inside the caller's
  `tx`. On `dedupKey` conflict → swallow (already queued). **Always callable**, even when Graph
  unconfigured (queuing is free; the worker decides whether to send).
- `runEmailOutbox(now?)`: under `SYSTEM_CTX`, select up to `RATE = 20` rows where
  `status=queued AND scheduledFor<=now`, oldest first. If `graphMailerFromEnv()===null` → log once
  "email disabled, leaving N queued" and return (do NOT mark failed — they send when configured).
  Else, per row: mark `sending`, call `sendViaGraph`, on success `sent`+`sentAt`; on
  `RateLimitError` → leave `queued`, bump `scheduledFor = now + backoff(attempts)`, stop the batch;
  on other error → `attempts++`, set `lastError`; after `MAX_ATTEMPTS=5` → `failed`. Each terminal
  transition writes a `logEvent`.
- `backoff(n) = min(2^n, 30) minutes` (exponential, capped).

## Cron wiring (`apps/api/src/index.ts`)

Inside the existing `if (process.env.DISABLE_CRON !== '1')` block, add:
```ts
cron.schedule('* * * * *', () => {            // every minute; internal rate cap = 20/run
  runEmailOutbox().then(r => { if (r.sent) console.log(`↳ email outbox: ${r.sent} sent, ${r.failed} failed`); })
                  .catch(e => console.error('email outbox tick failed', e));
});
```

## Env (.env.example additions)

```dotenv
# Microsoft Graph email (M365 A1). Unset = email disabled (queued, not sent — no error).
# App Registration (single-tenant) + certificate auth; see Phase 06 runbook.
GRAPH_TENANT_ID=""
GRAPH_CLIENT_ID=""
GRAPH_CERT_PATH=""                       # absolute path to PEM/PFX on the API host (NOT committed)
GRAPH_CERT_PASSWORD=""                    # optional PFX password
GRAPH_SENDER_NOTIFY="erp-notify@example.edu.vn"
GRAPH_SENDER_PAYROLL="payroll@example.edu.vn"
GRAPH_SENDER_HR="hr-onboarding@example.edu.vn"
```

## Tests (vitest, mock Graph via injected `fetchImpl`/`sendImpl`)

1. **No-op**: config unset → `runEmailOutbox` leaves rows `queued`, returns `{sent:0}`, no throw.
2. **Happy path**: 1 queued → mock send OK → row `sent`, `sentAt` set, audit logged.
3. **Idempotency**: enqueue same `dedupKey` twice → 1 row; worker sends once.
4. **Rate cap**: 25 queued → one tick sends ≤20, leaves ≥5 `queued`.
5. **429 backoff**: mock 429 → row stays `queued`, `scheduledFor` advanced, no data loss.
6. **Hard failure**: mock 500 ×5 → row ends `failed` with `lastError`.

## Validation

- `pnpm --filter @cmc/db generate && migrate:dev` (needs DB) — or document the migration SQL for
  Phase 06 if no DB at plan-execution time.
- `pnpm --filter @cmc/api typecheck` green; `test:int` green; full monorepo typecheck green.

## Risks / rollback

- Adds a dependency + a table. Rollback = drop table + revert files; no existing behavior touched.
- Worker is side-effect-free when unconfigured → safe to merge before MS config exists.
