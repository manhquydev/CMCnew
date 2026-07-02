# Red-Team Plan Review — Brevo External-Email Routing

Reviewer: code-reviewer (Failure Mode Analyst + Fact Checker + Contract Verifier)
Plan: `plans/260702-2352-email-brevo-external-routing/`
Tier: Standard (4 phases)

## Fact-check summary (verified before failure-mode analysis)

- `apps/api/src/lib/sso.ts:31-33` `emailAllowed` — VERIFIED (exact `endsWith('@'+domain...)` logic as cited, phase-02 §Context).
- `apps/api/src/lib/graph-client.ts` symbols cited by phase-01: `RateLimitError` :27, `graphMailerFromEnv` :39, `OutgoingEmail` :69, `SendDeps` :80, `sendViaGraph` :107 — all VERIFIED at cited lines.
- `packages/db/prisma/schema.prisma:790-810` `model EmailOutbox` — VERIFIED, no `transport` column present today, matches plan's stated "add" delta.
- `apps/api/src/services/email-outbox.ts` line anchors cited by phase-02 (`enqueueEmail` insert :62-74, `runEmailOutbox` no-op gate :115-129/:116-119, `drainOutbox` claim :138-156, hardcoded send :166-170) — all VERIFIED against the actual current file.
- `EnqueueInput` callers — VERIFIED full list via grep: `apps/api/src/lib/error-alert.ts:55`, `apps/api/src/routers/finance.ts:945,1410`, `apps/api/src/routers/payroll.ts:723`, `apps/api/src/routers/user.ts:356,375`, `apps/api/src/services/parent-meeting-reminder.ts:64`, plus 2 test call sites in `apps/api/test/email-outbox.int.test.ts:48,131`. Plan's claim "No change to `EnqueueInput` — callers already pass a resolved `to` string" holds for all 7 production call sites (none need edits).
- `docs/decisions/0028-refund-ledger.md` — VERIFIED exists, `0029` is correctly the next free number.
- `STAFF_EMAIL_DOMAIN` passthrough — VERIFIED at `docker/docker-compose.prod.yml:100`, `docker-compose.prod.tls.yml:71`, `scripts/prod-build-env.sh:52` (value `cmcvn.edu.vn`, i.e. **already live in prod today**).
- Phase-04 test-precedent anchors (`withoutGraphEnv` :17, `withGraphEnv` :32, `fetchReturning` :10, `beforeEach`/`afterAll` deleteMany :66-71) in `apps/api/test/email-outbox.int.test.ts` — all VERIFIED.
- `SECRET_KINDS = new Set(['otp_login', 'lms_account_ready'])` at `email-outbox.ts:30`, scrub-on-terminal at `:211-212` — VERIFIED, and both kinds are used for genuinely external (parent) recipients: `login-otp.ts:45` (parent LMS OTP) and `finance.ts:944-951` (`receipt.parentEmail`, `lms_account_ready` with `tempPassword`).

No fact-check failures found — the plan's file/line citations are accurate. The failure modes below are logic-level gaps, not factual errors.

---

## Finding 1: Migration backfill does not re-route already-broken external rows — silent permanent data loss for pending OTP/temp-password emails

- **Severity:** Critical
- **Location:** Phase 2, section "1. Schema" / "Backwards compatibility"
- **Flaw:** The migration sets `transport` via a blanket `DEFAULT 'graph'` for every existing row (phase-02 lines 50-58), with no data-driven backfill that re-runs `decideTransport(toAddress)` against each row's actual recipient. Every row already sitting in the outbox at migration time — including rows with `attempts > 0` that are *already* failing against Graph for the exact `550 5.7.708` reason this plan exists to fix — is permanently pinned to `transport='graph'`.
- **Failure scenario:** A parent-facing `lms_account_ready` row (carries `tempPassword`, `SECRET_KINDS` member, `email-outbox.ts:30`) or an `otp_login` row (`login-otp.ts:45`, also `SECRET_KINDS`) is `status='queued'`, `attempts=2` at migration time, having already failed twice against Graph's `550` block. Post-migration it is `transport='graph'`. The worker keeps retrying it via `sendViaGraph` — the same broken path — until `attempts >= MAX_ATTEMPTS` (5), at which point `drainOutbox` sets `status='failed'` AND applies `scrubPatch(row.templateKind)`, which for `SECRET_KINDS` blanks `bodyHtml` to `''` (`email-outbox.ts:211-212`, confirmed by the existing test `email-outbox.int.test.ts:129-143` which exercises exactly this scrub-on-terminal-fail path). The OTP code / temp password is now unrecoverably gone — this happens even after Brevo is configured and live, because nothing ever re-evaluates `transport` for this row. The parent never receives their LMS credentials and there is no queued retry path left; only a fresh business-event re-trigger (e.g. re-approving the receipt) would re-enqueue.
- **Evidence:** Migration SQL in phase-02 (lines 51-54): `ALTER TABLE "email_outbox" ADD COLUMN "transport" "EmailTransport" NOT NULL DEFAULT 'graph';` — no `UPDATE ... SET transport = 'brevo' WHERE to_address NOT LIKE '%@cmcvn.edu.vn'` or equivalent. Acceptance criteria explicitly states (plan.md:65) "Existing rows (pre-migration) all become `transport='graph'` via column default — no in-flight change" as if this were safe; it is not safe for rows whose in-flight state is "already broken by the bug this migration fixes."
- **Suggested fix:** Add a post-`ADD COLUMN` data migration step (in the same migration file, or a follow-up script) that re-runs the domain-split logic against `to_address` for all rows still in `('queued','sending')` status, e.g. `UPDATE email_outbox SET transport = 'brevo' WHERE status IN ('queued','sending') AND lower(to_address) NOT LIKE '%@' || lower(:staff_domain)`. Also consider resetting `attempts = 0` / `last_error = NULL` for rows being reclassified so they get a fresh backoff window on the newly-correct transport.

## Finding 2: Rollback plan has no enforced ordering — reverted code will indiscriminately re-drive Brevo-tagged rows through the broken Graph path

- **Severity:** High
- **Location:** Phase 2, section "Rollback"
- **Flaw:** The rollback note says: "If brevo-tagged rows already exist at rollback time, reverted code would route them via Graph (broken). Mitigation: before reverting, `UPDATE email_outbox SET status='failed'` for `transport='brevo' AND status IN ('queued','sending')` ... " This describes the correct *intent* but not an enforced *mechanism*. A code revert is a deploy action (new container image); the SQL mitigation is a separate manual DB action. Nothing in the plan sequences these atomically or pauses the cron between them.
- **Failure scenario:** Operator reverts phase-2 by redeploying the previous image (standard incident-response reflex: "roll back the deploy first, investigate DB after"). The reverted `drainOutbox` has zero knowledge of the `transport` column — its claim query (current code, `email-outbox.ts:138-156`) has no `transport` filter and its send call is hardcoded to `sendViaGraph` (current code, `:166-170`). On the very next cron tick — which can fire within seconds of the deploy completing — every `queued`/stale-`sending` row, Brevo-tagged or not, is claimed and sent via Graph. External-domain rows immediately hit the `550` block again, burn an attempt, and (for `SECRET_KINDS` rows) risk exactly the scrub-loss described in Finding 1 once they reach `MAX_ATTEMPTS`. The manual SQL "before reverting" step is not actually possible to run "before" a deploy that has already gone out — by the time an operator notices rollback is needed, the bad deploy is already live and the cron is already running.
- **Evidence:** Phase-02 "Rollback" (lines 157-163); current `drainOutbox` claim query has no transport awareness (`email-outbox.ts:138-156`, pre-patch).
- **Suggested fix:** State explicitly in the rollback runbook: (1) pause/disable the outbox cron trigger (or scale worker to 0) FIRST, (2) run the reclassification SQL, (3) only then deploy the code revert, (4) re-enable the cron. This ordering needs to be a numbered, blocking runbook step in phase-04's rollout/rollback section, not an aside in phase-02.

## Finding 3: Cross-transport batch contamination on rate-limit is understated as "Low×Low" — will materially delay external delivery under real parent-volume load

- **Severity:** Medium
- **Location:** Phase 2, section "Risks" (row: "Mixed-transport batch: one Brevo 429 rolls back Graph rows in same batch")
- **Flaw:** `drainOutbox`'s `RateLimitError` branch (current code `:189-204`) reschedules the *entire remaining claimed batch* — `claimed.slice(i)` — regardless of transport, when *any* row in the batch throws `RateLimitError`. Post-plan, `claimed` is a mixed-transport array ordered by `scheduledFor`, not partitioned by transport. The plan's own risk table acknowledges this ("Low×Low") but the severity assessment does not match the stated business context: this feature exists specifically because *external* (parent) mail is currently failing outright, so parent-volume through Brevo is presumably the dominant, time-sensitive traffic post-launch.
- **Failure scenario:** A batch of `RATE_PER_RUN=20` claimed rows contains 15 Brevo rows and 5 Graph rows interleaved by `scheduledFor`. If a Graph row at index 3 hits Exchange's rate limit, the remaining 16 rows — including up to 12 Brevo rows that were never rate-limited and had capacity to send — are all pushed back to `queued` with `scheduledFor = now + graph_retryAfterSec`. Brevo's own throughput (1k RPS base tier per phase-04) goes unused while parent notifications wait out a Graph-specific backoff window.
- **Evidence:** `email-outbox.ts:189-204` (current), phase-02 risk table row (lines 155).
- **Suggested fix:** Partition the rate-limit reschedule by transport — only push back remaining rows whose `transport` matches the transport that threw, and continue sending remaining rows of the other transport in the same loop iteration (or in a follow-up pass). Low effort relative to the throughput cost of not doing so, given this plan is explicitly designed to prioritize external deliverability.

## Finding 4: `decideTransport` is a one-time enqueue-time decision with no re-evaluation path, compounding Finding 1 for any future domain change

- **Severity:** Medium
- **Location:** Phase 2, section "2. `enqueueEmail` — decide transport"
- **Flaw:** Transport is decided once, at `INSERT` time, from `STAFF_EMAIL_DOMAIN` evaluated against `input.to`. There is no mechanism (admin action, backfill script, or reclassification job) to re-decide transport for rows already in the table, whether due to migration (Finding 1) or a future change to `STAFF_EMAIL_DOMAIN` itself (e.g., a second facility onboarding under a different staff domain, or Graph recovering and the org wanting to route some external partner domains back through Graph).
- **Failure scenario:** Same class of issue as Finding 1 but generalized: any operational change to the staff/external split after go-live leaves previously-enqueued rows permanently on their original transport, silently diverging from the "current" routing policy with no operator-visible signal (the row just looks like a normal `queued`/`failed` row; nothing flags "this row's transport classification is stale").
- **Evidence:** phase-02 §2 `decideTransport` (lines 60-76) — pure function of `input.to` at `enqueueEmail` call time, no subsequent recomputation anywhere in the plan.
- **Suggested fix:** At minimum, add an admin/CLI reclassification command (`re-route stuck rows`) as a documented recovery tool, referenced from the rollback and pre-flight docs, rather than relying on ad hoc `UPDATE` statements invented at incident time.

## Finding 5: Claim-query transport filter can permanently strand stale `sending` rows if a transport is temporarily de-configured mid-flight

- **Severity:** Medium
- **Location:** Phase 2, section "4. `drainOutbox` — claim only configured transports, branch per row"
- **Flaw:** The stale-lease reclaim clause (`status: 'sending', scheduledFor: { lte: staleBefore }`) is now ANDed with `transport: { in: configured }`. If a `brevo`-tagged row is claimed (flipped to `sending`) and the worker process crashes or `BREVO_*` env is unset before the row's outcome is recorded, that row sits in `status='sending'` indefinitely as long as `brevo` is absent from `configured` — it is invisible to both the "due" claim and the stale-lease reclaim until Brevo is reconfigured. This is a narrower version of the same "config drives claimability" design already accepted for the queued case (phase-02 line 136-138 calls the queued version "INTENTIONAL"), but the `sending`-state case is not explicitly called out or tested (phase-04's test matrix only covers "queued rows stay queued", not "a stuck `sending` row survives a config toggle").
- **Evidence:** phase-02 §4 claim query (lines 106-114); phase-04 test matrix (lines 50-58) has no case for a pre-existing stale `sending` row under a transport-config toggle.
- **Suggested fix:** Add a test case: seed a `sending` row past `LEASE_MS` with `transport='brevo'`, run with Brevo unconfigured (assert it stays `sending`, not silently lost), then run with Brevo configured (assert it gets reclaimed and retried). Document this as expected, not accidental, behavior.

## Finding 6: No operator-facing signal distinguishes "queued because Brevo isn't live yet" (expected) from "queued because it's stuck for another reason" (bug)

- **Severity:** Medium
- **Location:** Phase 2, "Backwards compatibility" / Phase 4, "Operator pre-flight checklist"
- **Flaw:** Per the plan's own design, `brevo`-tagged rows are expected to sit in `status='queued'` indefinitely until the pre-flight checklist (phase-04 §C) is complete and `BREVO_*` is set in prod. This is explicitly "no loss" by design. But nothing in phase 4 adds an operator-visible metric/alert distinguishing this expected pre-launch queue buildup from a genuine stuck-row bug (e.g., Finding 1's misclassified rows, or a future Brevo outage). The rollout note ("Watch audit `logEvent` ... + Brevo dashboard delivery events", phase-04 line 89) relies on manually eyeballing logs.
- **Failure scenario:** During the gap between phase-2 deploy and pre-flight completion (an operator-controlled but potentially multi-day window per phase-04 §D), the outbox accumulates an unbounded number of `queued` `brevo` rows with no alert threshold. If pre-flight is delayed (DKIM propagation commonly takes 24-48h), and a *concurrent* unrelated bug also causes rows to get stuck queued, there is no way to differentiate "expected backlog" from "new bug" without manually inspecting `transport` + `attempts` per row.
- **Evidence:** phase-04 §C step 6 language ("Until Brevo is live, external rows queue (no loss) but do not deliver") and §D rollout notes — no alert/metric requirement anywhere in the plan.
- **Suggested fix:** Not necessarily a blocking gap, but the plan should at minimum note a queue-depth threshold check (e.g., `SELECT count(*) FROM email_outbox WHERE transport='brevo' AND status='queued'`) as part of the existing structured-logging/error-alerting infrastructure referenced in the recent `feat(ops)` commit (`f876251`), since that alerting layer already exists in this codebase.

---

## Unresolved questions

- Should the migration's data-backfill (Finding 1) be a blocking phase-2 requirement, or is "accept the loss for the small number of currently-queued rows" an acceptable operator-confirmed trade-off? This needs an explicit decision, not silence, given it destroys parent-facing OTP/temp-password secrets.
- What is the actual current row count/age distribution of `queued`/`sending` rows in prod today (to size the blast radius of Finding 1 before deciding whether a backfill script is worth building)?
