---
title: "Brevo external-email transport, domain-routed alongside Graph"
description: "Add Brevo as a second email transport for external (parent) recipients, routed by recipient domain, keeping Graph for internal staff."
status: pending
priority: P1
effort: 13h
branch: develop
tags: [email, outbox, brevo, graph, transport, deliverability]
created: 2026-07-03
---

## Problem

Production M365 tenant returns `550 5.7.708` (tenant-reputation block) on outbound-**external**
mail — parent/guardian emails sent via Graph silently fail delivery. Internal-tenant delivery
(staff `@cmcvn.edu.vn`) is unaffected. Decision `0013` routes ALL recipients (parents + staff +
CRM) through Graph; that split must now be broken: **Brevo for external, Graph for internal**,
chosen per-recipient-domain at enqueue time.

## Solution shape

- New transport module `apps/api/src/lib/brevo-client.ts` mirroring `graph-client.ts`'s shapes
  (`brevoMailerFromEnv()` → config-or-null, `sendViaBrevo(cfg, msg, deps)`), reusing the existing
  `OutgoingEmail` type, `SendDeps`, and `RateLimitError` so `drainOutbox`'s retry/backoff logic
  treats both transports uniformly. New shared `apps/api/src/lib/email-routing.ts` (`decideTransport`,
  `isValidEmailFormat`) so both the outbox AND the OTP login path (see below) reuse one routing
  decision (red-team Finding 1).
- `EmailOutbox` gains a `transport` column (enum `graph|brevo`, default `graph`). `enqueueEmail`
  decides transport from the `to` string using `STAFF_EMAIL_DOMAIN` + the `endsWith('@'+domain)`
  logic already in `sso.ts:31-33`. `drainOutbox` branches per-row on `transport`, claiming and
  sending each transport's rows separately (not one shared mixed-transport batch — Finding 5/11).
- Fix the worker-wide no-op bug: today `runEmailOutbox` returns `disabled` if Graph alone is
  unconfigured, so a Brevo-only box would never drain. Resolve both configs; disable only when
  BOTH are null; claim only rows whose transport is configured.
- **Migration includes a data backfill, not just a column default** (Finding 2, Critical): rows
  already `queued`/`sending` at migration time get re-classified via `decideTransport`, not silently
  pinned to `transport='graph'` — otherwise already-broken external rows (some carrying OTP codes or
  temp passwords) would keep retrying the dead path until terminal failure scrubs the secret.
- **`login-otp.ts`'s `sendEmailNow` bypass is also fixed** (Finding 1, Critical): the parent LMS
  login OTP is the highest-stakes external email in the product and was previously unaddressed by
  this plan — it now routes through `decideTransport` too, keeping its existing synchronous
  fire-and-forget shape (not forced into the outbox, to preserve the timing-side-channel mitigation
  already in that code).
- New decision record `docs/decisions/0029-*` documenting the dual-transport split, the
  `550 5.7.708` root cause, a data-processing/third-party-exposure section (Finding 4), and the
  accepted risk that staff-domain enforcement isn't checked at account creation (Finding 9). Do NOT
  edit `0013`.
- Template layer (`email-templates.ts`) is transport-agnostic (`{subject, html}`) — reused as-is.
  `attachRef` is dead code on BOTH transports today, a pre-existing gap not introduced here (Finding 10).

## Phases

| # | Phase | Status | Depends on | File |
|---|-------|--------|-----------|------|
| 1 | Brevo transport module + shared routing + env vars | pending | — | [phase-01-brevo-transport-module.md](phase-01-brevo-transport-module.md) |
| 2 | Outbox schema + migration backfill + domain routing + drain branch + no-op fix + OTP fix | pending | 1 | [phase-02-outbox-transport-routing.md](phase-02-outbox-transport-routing.md) |
| 3 | Decision record 0029 (+ data-processing section) | pending | — (write anytime) | [phase-03-decision-record.md](phase-03-decision-record.md) |
| 4 | Validation: tests + operator pre-flight (real Brevo limit, not the unsourced 1k-RPS figure) + rollout | pending | 1, 2 | [phase-04-validation-and-preflight.md](phase-04-validation-and-preflight.md) |

Phases 1 and 3 have no code interdependency and can run in parallel. Phase 2 depends on 1
(imports `sendViaBrevo`/`brevoMailerFromEnv`/`decideTransport`/`isValidEmailFormat`). Phase 4 depends on 1+2.

## File ownership (no parallel overlap)

- Phase 1: `apps/api/src/lib/brevo-client.ts` (new), `apps/api/src/lib/email-routing.ts` (new),
  `apps/api/src/lib/graph-client.ts` (MODIFY — `RateLimitError` gains an optional `transport` label
  param, backward compatible), `.env.example` (add `BREVO_*`).
- Phase 2: `packages/db/prisma/schema.prisma`, new migration dir (with backfill),
  `apps/api/src/services/email-outbox.ts`, `apps/api/src/services/login-otp.ts` (MODIFY — OTP routing).
- Phase 3: `docs/decisions/0029-*.md` (new).
- Phase 4: `apps/api/test/brevo-client.test.ts` (new), `apps/api/test/email-routing.test.ts` (new),
  `apps/api/test/email-outbox.int.test.ts`, an OTP routing integration test,
  docker compose + `scripts/prod-build-env.sh` (env passthrough), operator checklist doc.

No two phases touch the same file for writes (phase 1 touches `graph-client.ts` only to widen an
optional constructor param, backward-compatible with zero required caller changes).

## Cross-cutting acceptance criteria

- Staff-domain recipient (`@cmcvn.edu.vn`) → row `transport='graph'`; any other → `transport='brevo'`.
- `STAFF_EMAIL_DOMAIN` unset → all rows `transport='graph'` (current behavior preserved).
- Brevo-only configured (Graph creds absent) → Brevo rows drain, Graph rows stay `queued` (not failed).
- Graph-only configured → Graph rows drain, Brevo rows stay `queued`.
- Both unconfigured → worker `disabled:true` no-op (unchanged).
- **Existing in-flight rows (pre-migration) are reclassified via `decideTransport` against their real
  recipient, not blanket-defaulted to `graph`** (Finding 2) — a row already failing against Graph's
  `550` block gets a real shot at Brevo instead of retrying the broken path to terminal failure.
- Brevo 429 reschedules only Brevo-claimed rows; a concurrent Graph 429 reschedules only Graph-claimed
  rows — the two transports no longer share one mixed claim batch (Finding 5/11).
- `requestLoginOtp` routes through the same `decideTransport` decision as the outbox (Finding 1) —
  parent OTP delivery is fixed by this plan, not left on the broken Graph path.
- `RateLimitError` messages correctly identify which transport rate-limited (Finding 8).
- API typecheck + lint clean; new + existing outbox/graph tests green against live Postgres.

## Out of scope (operator-confirmed, or accepted as documented risk after red-team)

- The old public website `D:\project\CMC\src\website` — reference only as prior art, do not touch/merge.
- Brevo inbound webhooks / bounce categorization / batch `messageVersions` endpoint (YAGNI). NOTE: the
  original "parent volume fits single-send at 1k RPS base" justification was found unsourced by
  red-team (Finding 3) — phase-04's pre-flight now requires confirming the REAL provisioned tier's
  limit from Brevo's dashboard before relying on this being sufficient headroom.
- No fallback of external mail back to Graph (Graph-external is the broken path). External rows queue
  until Brevo is configured — except OTP, which has no queue and is silently skipped if its decided
  transport isn't configured (same no-op-when-unconfigured behavior `sendEmailNow` already has today).
- Staff-domain enforcement at account creation (`user.create`) is not added — accepted risk (Finding 9),
  documented in decision 0029, that a misconfigured staff email could route through Brevo instead of
  Graph. Separate concern from this plan's actual problem.
- An admin/CLI tool to re-route already-enqueued rows after a future `STAFF_EMAIL_DOMAIN` policy
  change (distinct from this plan's one-time migration backfill) — tracked as a DEBT.md follow-up
  (Finding 12), not built here.
- New alerting/dashboard for outbox queue depth — reuses the existing `error-alert.ts` infrastructure
  via a documented manual check in the rollout runbook, no new alerting code (Finding 14).

## Key risks (roll-up; per-phase detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Deploy routing before Brevo sender verified → external mail stalls in queue | High×Med | Phase-04 pre-flight gates deploy; queued (not lost); drains once Brevo live |
| Brevo sender address not DKIM-verified → mail rewritten/spam-flagged | Med×High | Pre-flight checklist: per-sender verification + DNS DKIM BEFORE go-live |
| **In-flight rows already failing pre-migration stay pinned to the broken transport, risking secret-scrub data loss (OTP/temp password)** | Was Low×High, now mitigated | **Fixed, not just mitigated:** migration backfill reclassifies via `decideTransport`, resets `attempts`/`lastError` (Finding 2) |
| **Parent LMS login OTP left on the broken Graph path even after this plan ships** | Was unassessed (Critical gap), now mitigated | **Fixed:** `login-otp.ts` routes through `decideTransport` too (Finding 1) |
| Rollback of phase 2 after brevo rows exist → they'd route to broken Graph | Med×Med | Enforced ordering: pause cron → reclassify (mark `failed`) → deploy revert → resume cron (Finding 6) — was previously an unenforced "before reverting" note |
| Unsourced Brevo capacity figure used to justify skipping batch support / sizing pre-flight | Med×Med | Pre-flight now requires reading the real dashboard limit, not the research doc's figure (Finding 3) |
| New third-party processor for OTP codes / temp passwords with no compliance review | Med×High | Decision 0029 gains a data-processing/access-isolation section (Finding 4) |
| Shared rate cap starves one transport under the other's burst | Med×Med | Per-transport claim/send split, `GRAPH_RATE_PER_RUN`/`BREVO_RATE_PER_RUN` (Finding 5/11) |

## Red Team Review

### Session — 2026-07-03
**Findings:** 17 raw (3 reviewers: Security Adversary, Assumption Destroyer, Failure Mode Analyst),
deduped to 14 (17 accepted, 3 duplicate pairs merged into 11-14's entries)
**Severity breakdown:** 2 Critical, 4 High, 8 Medium
**Evidence filter:** all 14 passed (every finding cited file:line from the actual codebase; fact-check
passes across all 3 reviewers found zero citation errors in the plan's own claims)

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | OTP login (`login-otp.ts`) bypasses the outbox, stays on broken Graph | Critical | Accept | Phase 1 (new `email-routing.ts`), Phase 2 (§5, new) |
| 2 | Migration backfill doesn't reclassify already-broken in-flight rows | Critical | Accept | Phase 2 (§1) |
| 3 | "1k RPS base plan" Brevo capacity claim unsourced, conflates RPS with daily quota | High | Accept | Phase 4 (§C.1) |
| 4 | New third-party processor for OTP/PII, no compliance review in decision record | High | Accept | Phase 3 |
| 5 | Shared `RATE_PER_RUN=20` cap not split per transport | High | Accept | Phase 2 (§4) |
| 6 | Rollback runbook has no enforced ordering, conflicting default action | High | Accept | Phase 2 (Rollback) |
| 7 | `decideTransport` has no email-format validation | Medium | Accept | Phase 1 (`email-routing.ts`), Phase 2 (§2) |
| 8 | `RateLimitError` message hardcoded "Graph" even for Brevo 429s | Medium | Accept | Phase 1 |
| 9 | Domain-routing assumes internal=staff-domain, not enforced at account creation | Medium | Accept (documented risk, not new validation) | Phase 2 (§2), Phase 3 |
| 10 | `attachRef` dead-code framed as Brevo-specific when it's dead on both transports | Medium | Accept | Phase 1, Phase 2 (Risks) |
| 11 | Cross-transport batch-reschedule risk rated Low×Low without re-derivation | Medium | Accept (fixed, not just re-rated) | Phase 2 (§4) |
| 12 | `decideTransport` one-time decision, no reclassification path for future policy change | Medium | Accept (scoped to DEBT.md follow-up) | Phase 2 (Rollback) |
| 13 | Claim-query can strand stale `sending` rows if transport de-configured mid-flight | Medium | Accept | Phase 4 (test case) |
| 14 | No operator signal distinguishing expected Brevo backlog from a stuck-row bug | Medium | Accept (docs only) | Phase 4 (§D) |

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, `phase-01-brevo-transport-module.md`, `phase-02-outbox-transport-routing.md`,
  `phase-03-decision-record.md`, `phase-04-validation-and-preflight.md`.
- Decision deltas checked: 9 (new `email-routing.ts` module; `decideTransport` moved out of
  `email-outbox.ts`-local scope; `RateLimitError` constructor signature widened; migration gains a
  backfill step; `login-otp.ts` added to phase-2 scope; `RATE_PER_RUN` split into two constants;
  rollback ordering enforced with a stated default action; phase-03 gains a data-processing section;
  phase-04's Brevo-capacity pre-flight step rewritten).
- Reconciled stale references: `plan.md`'s Solution shape, Phases table, File ownership, acceptance
  criteria, out-of-scope list, and risk table all updated to match. Phase 1's "nothing imports it
  until phase 2" note updated to cover both new files. Phase 2's context section, data-flow line, and
  backwards-compatibility section updated to reflect the reclassifying migration (not a static
  default) and the OTP fix. Phase 4's test matrix, files list, and pre-flight checklist step 1 updated
  to drop the unsourced RPS figure and add the new test cases (migration backfill, OTP routing,
  per-transport 429 isolation, stale-sending-row survival).
- Unresolved contradictions: 0.

## Validation Log

### Session 1 — 2026-07-03
**Trigger:** Operator instruction to run the full harness plan cycle (scout → plan → red-team →
validate) before stopping, no implementation this pass.
**Verification pass:** skipped per validate-workflow's guard — `## Red Team Review` above already
contains verification evidence (all 3 red-team reviewers' fact-check passes found zero citation
errors in the plan's claims).
**Questions asked:** 5

#### Questions & Answers

1. **[Risk]** Finding 4: OTP/temp-password data going through Brevo means it shares the marketing
   site's Brevo account if reused. Keep sharing the old account or isolate CMCnew into a new
   account/sub-account?
   - Options: Keep sharing (document accepted risk) | Isolate into a new account/sub-account (Recommended)
   - **Answer:** Keep sharing the old account, document as accepted risk.
   - **Rationale:** Fastest path (no new domain verification needed), but changes the risk
     acceptance from "undecided" to "explicit operator call" — decision 0029 now requires recording
     the actual list of people with dashboard access, not just noting the risk exists.

2. **[Assumption]** OTP fix (Finding 1): if the decided transport isn't configured when a parent
   requests an OTP, should the send silently no-op (matches today's Graph-unconfigured behavior) or
   fall back to attempting Graph anyway?
   - Options: Silent no-op (Recommended) | Fallback-attempt Graph
   - **Answer:** Silent no-op, as originally designed.
   - **Rationale:** Consistent with the plan's global "no fallback of external mail back to Graph"
     principle (Graph-external is the broken path) — confirmed, no phase change needed.

3. **[Risk]** Finding 6: rollback default action for brevo-tagged rows — mark `failed` (visible,
   explicit) or leave `queued` (no immediate loss, but can strand invisibly)?
   - Options: Mark failed, explicit (Recommended) | Leave queued
   - **Answer:** Mark failed.
   - **Rationale:** Matches the red-team's own reasoning (a reverted, transport-blind codebase can
     never correctly reclaim a queued brevo row again) — confirmed, no phase change needed.

4. **[Architecture]** Finding 2's migration backfill — implement via a TS script reusing
   `decideTransport` (one source of truth) or raw SQL string-matching inside the migration file
   (atomic with the schema change, but duplicates the domain-comparison logic)?
   - Options: TS script reusing `decideTransport` (Recommended) | Raw SQL in the migration
   - **Answer:** TS script reusing `decideTransport`.
   - **Rationale:** Confirmed as designed in phase 2 §1 — no phase change needed.

5. **[Scope]** `BREVO_RATE_PER_RUN` starting value before the real Brevo tier limit is confirmed at
   pre-flight — 20 (matches Graph's existing cap) or a more conservative lower starting value?
   - Options: 20, adjust after pre-flight (Recommended) | Lower (e.g. 5), ramp up later
   - **Answer:** 20.
   - **Rationale:** Confirmed as designed in phase 2 §4 — pre-flight already gates the real-limit
     check before go-live, so starting at parity with Graph is low-risk. No phase change needed.

#### Confirmed Decisions
- Brevo account: shared with the existing marketing site, explicit accepted risk (not isolated).
- OTP-unconfigured behavior: silent no-op, no Graph fallback.
- Rollback default: mark brevo rows `failed`, not `queued`.
- Migration backfill: TS script reusing `decideTransport`, not raw SQL.
- `BREVO_RATE_PER_RUN` starting value: 20.

#### Action Items
- [x] Phase 3: strengthened the data-processing section to require recording the actual list of
      people with Brevo dashboard access, given the shared-account decision (applied).
- [ ] No other phase file changes required — all 5 answers confirmed the plan exactly as red-teamed.

#### Impact on Phases
- Phase 3: data-processing section tightened (access-list requirement, explicit "confirmed shared
  account" framing) — applied.
- Phases 1, 2, 4: no changes — all validation answers matched the as-written design.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all 4 `phase-*.md` files.
- Decision deltas checked: 5 (all from the Q&A above).
- Reconciled stale references: phase-03's data-processing section updated from "must document
  whether isolated" (open question) to "confirmed shared, must document access list" (closed
  decision) — the only file needing a language change since it was phrased as an open question
  pending this exact validation answer.
- Unresolved contradictions: 0.

## Next Steps

Full harness cycle complete for this plan: scout → research → plan → red-team (14 findings applied)
→ validate (5 decisions confirmed, 0 unresolved contradictions). **Per operator instruction, stopping
here — no implementation this pass.**

When ready to implement: `/clear` first for a fresh context, then run
`/ck:cook D:\project\CMCnew\plans\260702-2352-email-brevo-external-routing\plan.md`.
