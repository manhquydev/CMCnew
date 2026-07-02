# Red-team review — ops-hardening plan (260702-1109)

Reviewer: code-reviewer (adversarial pass). No code/plan files modified.

## Verdict: FIX-FIRST

Plan direction is sound and the P2 format-mismatch diagnosis is correct and verified. But P1 has an
unlisted required file dependency that breaks the "zero new infra cost" claim, and P2 has a real
data-loss gap (file-store blobs excluded from backup, and the DEBT.md record of that exact risk has
already been silently dropped from the working tree by the uncommitted Plan-1 change). Fix both before
implementation; P3/P4/P5 are lower-risk with minor inaccuracies noted below.

---

## CRITICAL

### C1 — Backup plan is DB-only; uploaded PDF/session-photo blobs are never backed up, and the prior documented warning about this has vanished from DEBT.md
- Verified: `apps/api/src/services/pdf-store.ts:9` and `photo-store.ts:19` write to local disk
  (`.data/pdf`, `.data/session-photos` by default, or `PDF_STORE_DIR`/`SESSION_PHOTO_STORE_DIR`).
  `scripts/backup-db.sh` only runs `pg_dump` against Postgres — no file-store copy anywhere in P2.
- Prisma schema stores `basePdfRef`/photo refs pointing at these files; a DB restore without the
  matching blobs leaves dangling references (exercises with unopenable PDFs, session evidence with
  missing photos).
- This exact risk was previously recorded: `git show HEAD:DEBT.md` contains *"DEBT: MinIO
  content-addressed object store (spec §3) deferred... Dev-only: exercise PDFs live on the API host's
  local data dir, not a durable/replicated object store... close before: Before production go-live:
  swap driver to MinIO/S3"*. The **working tree's `DEBT.md` (rewritten uncommitted by the Plan-1
  implementation, `git diff HEAD -- DEBT.md`) drops this entry entirely** along with the CI/CD-Jenkins
  debt item and the identity-tables RLS ACCEPTED note — replaced by a differently-scoped "Backend-Ready
  UI Gaps" list that doesn't mention local-disk storage at all.
- Net effect: P2 (backup) doesn't cover blobs, and P5 (docs hygiene) has no requirement to re-surface
  this known gap — it will simply stay invisible after this plan lands, because the one place it was
  written down already disappeared underneath this plan without anyone flagging it.
- Fix: either (a) add a `tar`/`rsync` step for `PDF_STORE_DIR`/`SESSION_PHOTO_STORE_DIR` to
  `backup-db.sh`, or (b) explicitly re-add a DEBT.md item stating file-store backup is out of scope and
  file-store data loss is accepted risk until MinIO/S3 migration. Silence is not an option here — this
  is a live production data-loss vector once the restore drill "passes" on DB-only parity.

---

## MAJOR

### M1 — P1's "reuse `enqueueEmail`, zero new infra cost" claim is false as scoped; a required file is missing from the file-ownership table
- Verified `apps/api/src/services/email-outbox.ts:52` — `enqueueEmail<K extends EmailTemplateKind>(tx, input)`
  requires `kind: K` and `data: TemplatePayloads[K]`, both defined in `apps/api/src/services/email-templates.ts`.
  `EmailTemplateKind` (`email-templates.ts:5-11`) is a closed union:
  `payslip_ready | account_security_alert | parent_meeting | otp_login | lms_account_ready | account_welcome`.
  There is no error/ops-alert kind, and `renderTemplate` (`:216`) switches on the union exhaustively.
- The closest existing kind, `account_security_alert`, has payload `{ name?: string; action: string; at:
  string }` (`:99`) — shaped for a single account event, not an error-rate window/count. Reusing it would
  be a semantic misuse (or requires threading fake fields).
- P1's "Related code files" list (phase-01, lines 43-47) and plan.md's file-ownership table (line 38) do
  **not** include `email-templates.ts`. An implementer following the plan literally hits a TS error
  (`Argument of type '"error_alert"' is not assignable to parameter of type 'EmailTemplateKind'`) and has
  to improvise a new template kind + renderer that the plan never scoped, sized, or reviewed.
- Fix: add `email-templates.ts` to P1's file list, define a new `EmailTemplateKind` member (e.g.
  `ops_error_alert`) + `TemplatePayloads` entry + renderer, update Success Criteria to reflect this isn't
  literally zero new code.

### M2 — P1 architecture diagram references `SYSTEM_CTX` as if importable; it's private
- `apps/api/src/services/email-outbox.ts:20`: `const SYSTEM_CTX = { facilityIds: [], isSuperAdmin: true };`
  — not exported. P1's architecture section (phase-01 line 39) shows
  `withRls(SYSTEM_CTX, tx => enqueueEmail(...))` inside `error-alert.ts`, implying reuse of the same
  constant. As written, `error-alert.ts` must define its own literal (duplicating, not importing) or
  `email-outbox.ts` needs an `export` added (another unlisted file touch). Low effort to fix but the plan
  currently reads as "import SYSTEM_CTX" which will not compile.

### M3 — `.env.example` "9 missing vars" enumeration is incomplete; misses `LMS_COOKIE_NAME`
- Verified via grep of `apps/api/src` for `process.env.*`: `LMS_COOKIE_NAME` is read at
  `apps/api/src/context.ts:7` (`process.env.LMS_COOKIE_NAME ?? 'cmc.lms'`) and used across
  `index.ts`/`lms-auth.ts` for the LMS auth cookie name — a security-relevant value — but is absent from
  both the current `.env.example` and phase-05's enumerated list (STAFF_PASSWORD_LOGIN + DISABLE_CRON +
  7 rate-limit/store vars = 9). Actual undocumented-var count is ≥10.
- Not fatal: phase-05 step 5 ("re-grep `process.env.` after editing to confirm no read var is still
  undocumented") is a self-correcting check *if actually executed*, but the plan's claim to have already
  "verified via grep" is inaccurate and should not be trusted as the final list — the re-grep step must
  actually run, not be treated as a formality.

### M4 — P3's port-collision "acceptable" conclusion cites the wrong safety mechanism
- Verified `docker/jenkins-casc.yaml:4`: `numExecutors: 1` (single global executor) and
  `docker/jenkins-casc.yaml:34-57`: job is `multibranchPipelineJob` with `gitHubPullRequestDiscovery` —
  so `changeRequest()` in P3's proposed `when` block will work as intended (confirms P3's core mechanism
  is sound).
- However, P3's risk section (phase-03 line 62) attributes serialization safety for the hardcoded
  `55432` port in `ci-integration-tests.sh` to `disableConcurrentBuilds()` (`Jenkinsfile:9`). That
  directive only prevents concurrent builds *of the same branch/job*; in a multibranch pipeline each
  branch/PR is a distinct job, so it does NOT by itself prevent a PR build and a `main` build (or two PR
  builds) from running concurrently and colliding on port 55432. The actual — and only — reason this is
  currently safe is `numExecutors: 1` (one global build slot across the whole Jenkins controller).
  The plan's mitigation reasoning is factually wrong even though its practical conclusion (no collision
  today) happens to hold. If `numExecutors` is ever raised (a very plausible future change once PR gates
  add queue time, which P3 itself flags as a cost), the port collision this plan dismisses as "LOW" will
  reappear silently, and nobody will connect it back to `disableConcurrentBuilds()` not covering it.
  Recommend fixing the reasoning in the risk note now (cite `numExecutors: 1`, not
  `disableConcurrentBuilds()`) so a future executor bump doesn't quietly reintroduce this.

---

## MINOR

### N1 — P4's app glob includes a nonexistent app
- `apps/` currently contains only `admin`, `api`, `e2e`, `lms` (no `teaching` — consistent with the
  memory note "gộp admin+teaching 1 app"). Both the existing `eslint.config.js:74`
  (`apps/teaching/src/**/*.{ts,tsx}`) and P4's proposed new rule glob
  (`apps/{admin,teaching,lms}/src/**/*.{ts,tsx}`, phase-04 line 36) reference `apps/teaching/src`, which
  matches zero files. Harmless (dead glob entry, mirrors an existing harmless pattern) but worth
  trimming when touching the file rather than propagating a stale app name forward.

### N2 — P4's "0 raw prisma imports" claim was verified only for `apps/api/src`, but the new rule is scoped wider
- Grep across `apps/**` for `from '@prisma/client'` / raw `prisma` from `@cmc/db` found zero hits in
  `apps/admin/src` and `apps/lms/src` too, so the plan's green-baseline claim does hold in practice —
  but phase-04's "Key Insights" only states the grep was run for `apps/api/src`, not for the
  admin/lms globs the new rule also covers. Recommend the plan's verification note be corrected to say
  the full multi-app surface was checked (it now has been, per this review), not just API.

### N3 — DEBT.md line-citation coincidence should be called out explicitly, not left implicit
- Phase-05 cites `DEBT.md:13` (payroll director-read) and an "unresolved Q at `:23`" — these line numbers
  match the **current uncommitted working-tree DEBT.md** (post Plan-1 rewrite), not `git HEAD`'s DEBT.md
  (which has completely different content/structure — checkbox-based, different topics, see C1). This
  means phase-05 was written against the already-modified tree, which is correct for execution — but the
  plan should say so explicitly ("DEBT.md as currently modified by the uncommitted Plan-1 change", not
  bare `DEBT.md:13`), since a reader diffing against `main`/HEAD will otherwise think the citation is
  stale or wrong. Also note: the current DEBT.md's phrasing of the payroll line is already
  effectively "decided", not an open checkbox gap — P5's instruction to "move from gap to closed/decided
  note" is a smaller edit than it sounds (heading placement / wording only), not a status flip.

---

## Verified as correct (no issue)

- P2's core diagnosis — `backup-db.sh` emits plain SQL (`pg_dump ... --clean --if-exists | gzip`,
  `scripts/backup-db.sh:22-24`) while `db-restore.sh` calls `pg_restore` which only reads custom/`-Fc`
  archives (`scripts/db-restore.sh:49-57`), and `db-backup.sh` is the only `-Fc` producer
  (`scripts/db-backup.sh:41-47`) — is accurate. Deleting `db-backup.sh` without rewriting
  `db-restore.sh` to the plain-SQL/psql path would leave restore permanently broken. Repo-wide grep for
  other `db-backup.sh` references found only historical plan docs (`plans/260701-1906-.../phase-03-...md`)
  and a superseded assessment report — no live doc/script depends on it, so deletion + repoint is safe.
- P1's "zero logging/error-boundary today" claim — verified `apps/api/src/index.ts` has no `app.onError`
  and only scattered `console.log`/`console.error` in the cron ticks (lines 380, 389, 391, 399, 401,
  410, 412). Accurate.
- `email-outbox.ts`'s `dedupKey` is DB-globally-unique (`EmailOutbox.dedupKey @unique`,
  `packages/db/prisma/schema.prisma:758`), consistent with P1's per-window dedup design.
- Jenkins job is genuinely multibranch with PR discovery enabled (`jenkins-casc.yaml`), so P3's
  `changeRequest()` gate mechanism will work as designed — P3's core change is low-risk.
- P5's env-var gap list (minus the one miss in M3) is otherwise accurate — spot-checked
  `STAFF_PASSWORD_LOGIN`, `DISABLE_CRON`, `LOGIN_RATE_*`, `LEAD_RATE_IP_LIMIT`, `OTP_RATE_LIMIT`,
  `PDF_STORE_DIR`, `SESSION_PHOTO_STORE_DIR` all confirmed read via `process.env.*` and absent from
  `.env.example`.
- File ownership table (plan.md) has no real cross-phase file collision for the phases as scoped, aside
  from the unlisted `email-templates.ts` touch in M1 (which no other phase claims, so it's an omission,
  not a conflict).

---

## Unresolved Questions

1. C1: should file-store backup be implemented in this plan (scope increase) or explicitly deferred with
   a restored DEBT.md entry? Needs an operator/planner decision — recommend NOT silently shipping backup
   as "done" without one or the other.
2. Was DEBT.md's rewrite (dropping MinIO/CI-Jenkins/identity-RLS entries) an intentional cleanup by the
   Plan-1 author, or an oversight? This review only confirms the diff exists and that it removes a
   still-relevant risk note (C1); it does not have visibility into Plan-1's intent.
3. M1/M2 sizing: once `email-templates.ts` is added to scope, does the 14h total effort estimate still
   hold, or does phase-01 need a bump?

## Status / Summary
Status: DONE_WITH_CONCERNS
Summary: P2's format-mismatch diagnosis is correct, but backup scope misses file-store blobs and silently loses the one DEBT.md record of that exact risk (CRITICAL, C1). P1 undersizes itself — `enqueueEmail` requires touching an unlisted `email-templates.ts` for a new template kind, and references a non-exported `SYSTEM_CTX` (MAJOR, M1/M2). `.env.example` var list misses `LMS_COOKIE_NAME` (M3) and P3's port-safety reasoning cites the wrong Jenkins mechanism (M4, conclusion still holds today via `numExecutors:1`). P4/P5 core designs verified correct with minor cosmetic gaps (N1-N3). Recommend FIX-FIRST: resolve C1 decision + M1/M2 scope additions before implementation; other findings can be fixed inline during implementation.
