# Phase 01 — Brevo transport module + env vars

## Goal

New `apps/api/src/lib/brevo-client.ts` mirroring `graph-client.ts` function shapes, so `drainOutbox`
can send external mail through Brevo with the same call/error contract as Graph. Also creates a new
shared `apps/api/src/lib/email-routing.ts` housing `decideTransport()` and a cheap email-format
guard — pulled out of phase 2's original design (which had `decideTransport` as an
`email-outbox.ts`-local helper) because phase 2 (this session's red-team, Finding 1) found the OTP
login path (`login-otp.ts`) also needs transport routing and bypasses the outbox entirely, so the
decision function must be importable from both places. Pure addition — nothing imports either new
file until phase 2, so it ships inert.

## Context

- Mirror: `apps/api/src/lib/graph-client.ts` — `graphMailerFromEnv()` (`:39`), `sendViaGraph()`
  (`:107`), `RateLimitError` (`:27`), `OutgoingEmail` (`:69`), `SendDeps` (`:80`).
- Brevo API (research report §1): `POST https://api.brevo.com/v3/smtp/email`, header `api-key: <key>`
  (NOT Bearer), success `201` + `{ messageId }`. Errors: 401/403 auth, 400 unverified sender,
  422 bad payload, 429 rate limit.
- Reuse the existing `OutgoingEmail` type (`mailbox` field is ignored by Brevo — single sender).
- Reuse `RateLimitError` and `SendDeps` by importing from `./graph-client.js` — DRY, and lets
  `drainOutbox` catch one error class for both transports.
  **Red-team fix (Finding 8, accepted):** `RateLimitError`'s message was Graph-flavored even when
  thrown by the Brevo path, misleading on-call engineers during exactly the incident type (rate
  limiting) it exists to signal. Add an optional `transport` label param (default `'graph'` so the
  existing Graph throw site needs no change) rather than extracting a whole new module — cheaper fix
  than the deferred "extract to `lib/email-transport.ts`" alternative floated earlier, no longer
  YAGNI-deferred since it's a 2-line change:
  ```ts
  // graph-client.ts — MODIFY the existing class
  export class RateLimitError extends Error {
    constructor(public retryAfterSec: number, transport: 'graph' | 'brevo' = 'graph') {
      super(`${transport} sendMail rate-limited; retry after ${retryAfterSec}s`);
    }
  }
  ```
  `brevo-client.ts`'s 429 throw site passes `'brevo'` explicitly (see implementation below).

## Files

- CREATE `apps/api/src/lib/brevo-client.ts`
- CREATE `apps/api/src/lib/email-routing.ts` — shared `decideTransport(to)` + `isValidEmailFormat(to)`,
  used by phase 2's `enqueueEmail`/`drainOutbox` AND by the `login-otp.ts` fix (Finding 1, see phase 2).
- MODIFY `apps/api/src/lib/graph-client.ts` — `RateLimitError` gains the `transport` param (Finding 8).
- MODIFY `.env.example` — add `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` near the
  Graph block (lines ~78-99).

## `email-routing.ts` (new)

```ts
export type EmailTransport = 'graph' | 'brevo';

// External recipients (parents/guardians) go via Brevo; internal staff (@STAFF_EMAIL_DOMAIN) via
// Graph. When STAFF_EMAIL_DOMAIN is unset the whole feature is single-transport → default to graph
// so current behavior is preserved (no accidental brevo routing on an unconfigured box).
export function decideTransport(to: string): EmailTransport {
  const domain = process.env.STAFF_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return 'graph';
  const isStaff = to.trim().toLowerCase().endsWith(`@${domain}`);
  return isStaff ? 'graph' : 'brevo';
}

// Cheap format guard (Finding 7, accepted) — not full RFC5322 validation, just enough to fail fast
// on an obviously-malformed address (no '@', empty) at enqueue time instead of burning a 5-attempt
// retry cycle against whichever transport it happens to route to.
export function isValidEmailFormat(to: string): boolean {
  const trimmed = to.trim();
  return trimmed.length > 3 && trimmed.includes('@') && !trimmed.startsWith('@') && !trimmed.endsWith('@');
}
```

Not imported by `sso.ts`'s `emailAllowed` (semantically "allowed to SSO-login", a different intent,
per phase 2's original DRY-of-logic-not-import note) — but `decideTransport` mirrors the exact same
`endsWith('@'+domain)` comparison.

## Implementation

### `brevo-client.ts`

```ts
import { RateLimitError, type OutgoingEmail, type SendDeps } from './graph-client.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoMailerConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

// Null when the minimum set is unset → caller treats Brevo as unconfigured (rows stay queued).
// senderName defaults to senderEmail so a missing display name never blocks send.
export function brevoMailerFromEnv(): BrevoMailerConfig | null {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) return null;
  return { apiKey, senderEmail, senderName: process.env.BREVO_SENDER_NAME || senderEmail };
}

// Send one email via Brevo. Throws RateLimitError on 429 (worker backs off, same as Graph),
// plain Error on any other non-2xx (worker counts the attempt). msg.mailbox is ignored — Brevo
// has a single verified sender. Only deps.fetchImpl is used (Brevo auth is a stateless api-key,
// no token step); deps.getToken is accepted for signature-uniformity and ignored.
export async function sendViaBrevo(
  cfg: BrevoMailerConfig,
  msg: OutgoingEmail,
  deps: SendDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: cfg.senderName, email: cfg.senderEmail },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
    }),
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
    throw new RateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60, 'brevo');
  }
  // Brevo returns 201 Created + { messageId } on success.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo sendEmail HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}
```

Notes:
- No attachment handling (parent notification/receipt templates that need attachments today go via
  Graph `payroll`/`hr` mailboxes to staff, or `attachRef` is null for parent kinds). If a
  brevo-routed kind ever carries an attachment, Brevo needs `attachment: [{ content(base64), name }]`
  — out of scope now (YAGNI); note as unresolved Q.
- Do NOT import `@azure/identity` or any token logic — Brevo is stateless.

### `.env.example`

```dotenv
# Brevo (transactional email for EXTERNAL recipients — parents/guardians). Decision 0029.
# Graph 550 5.7.708 tenant-reputation block makes M365 unusable for outbound-external mail.
# Sender address MUST be verified + DKIM-configured in the Brevo dashboard before go-live (phase 04).
BREVO_API_KEY=""
BREVO_SENDER_EMAIL=""
BREVO_SENDER_NAME="CMC"
```

## Data flow

`brevoMailerFromEnv()` → config|null (consumed by `runEmailOutbox` in phase 2, and by the
`login-otp.ts` fix — see phase 2 Finding-1 section).
`sendViaBrevo(cfg, {to, subject, html})` → POST → 201 (resolve void) | 429 (throw
`RateLimitError(sec,'brevo')`) | other (throw Error).
`decideTransport(to)` (from `email-routing.ts`) → `'graph' | 'brevo'`, pure function of
`STAFF_EMAIL_DOMAIN` + `to`.

## Tests (implemented in phase 4, listed here for contract)

Unit `brevo-client.test.ts` (mirror `email-graph-client.test.ts`, no DB): null-when-unset; 201 POST
shape (api-key header present, `sender.email`, `to[0].email`, `htmlContent`); 429→RateLimitError
with message containing `'brevo'` (not `'graph'` — regression guard for Finding 8); 500→plain Error.

Unit `email-routing.test.ts` (new, pure function, no DB): `decideTransport` — staff-domain → graph,
external → brevo, `STAFF_EMAIL_DOMAIN` unset → graph; `isValidEmailFormat` — rejects empty/no-@/
leading-or-trailing-@, accepts a normal address.

## Risks

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Import cycle graph↔brevo | Low×Low | One-way import brevo→graph only; graph never imports brevo |
| Brevo error body leaks api-key in logs | Low×Med | Only `res.text()` (response body) sliced to 300 chars is logged, never the request/api-key |
| Signature drift from Graph breaks uniform drain call | Low×Med | Reuse `OutgoingEmail`+`SendDeps` verbatim; same `(cfg,msg,deps)` arity |
| `RateLimitError` signature change breaks an existing caller | Low×Med | Optional 2nd param with default `'graph'` — fully backward compatible, no existing call site needs to change |

## Rollback

Pure addition, zero callers until phase 2 (except the `RateLimitError` signature change, which is
backward-compatible per the risk row above). Revert the new files + `.env.example` lines +
`RateLimitError` constructor. No runtime impact.

## Done = observable

- `pnpm --filter @cmc/api typecheck` + lint clean with the new files.
- `brevoMailerFromEnv()` returns null with vars unset, config object with them set (asserted in phase 4).
- `decideTransport`/`isValidEmailFormat` unit-tested in isolation (asserted in phase 4).
