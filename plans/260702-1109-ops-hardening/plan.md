---
title: "Ops hardening: monitoring + backup cron + CI PR gates + RLS lint guard + docs hygiene"
description: "Structured logging + error alerting, real backup cron with restore drill, integration tests on PR, ESLint RLS-bypass guard, and stale docs/status cleanup."
status: pending
priority: P1
effort: 14h
branch: develop
tags: [ops, monitoring, backup, ci, docs]
created: 2026-07-02
---

# Ops hardening

Infra lane. Independent of product code — runs earliest (before/parallel to Plan 1 seam-fixes), touches
disjoint files. Source: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md` §"PLAN 7".

## Lane: normal (maintenance)

Per `docs/FEATURE_INTAKE.md` risk checklist: touches external-ops (backup, CI) + weak-proof areas, but
**no** hard gate — no auth/authz change, no schema/migration, no prod data-loss path (restore drill runs on a
throwaway DB, never prod). 1 soft flag (external systems). → normal with stronger validation + operator-assisted
steps flagged. Backup/CI/deploy execution on the live VPS is operator-assisted (agent cannot reach it).

## Phases

| # | Phase | File | Status | Depends |
|---|-------|------|--------|---------|
| 1 | Structured logging + error tracking + alerting | [phase-01-logging-error-tracking.md](phase-01-logging-error-tracking.md) | pending | — |
| 2 | Backup cron install + dedupe + restore drill | [phase-02-backup-cron-restore-drill.md](phase-02-backup-cron-restore-drill.md) | pending | — |
| 3 | Jenkins PR gates (integration tests on PR) | [phase-03-jenkins-pr-gates.md](phase-03-jenkins-pr-gates.md) | pending | — |
| 4 | ESLint RLS-bypass guard | [phase-04-eslint-rls-guard.md](phase-04-eslint-rls-guard.md) | pending | — |
| 5 | Docs / status hygiene + .env.example sync | [phase-05-docs-status-hygiene.md](phase-05-docs-status-hygiene.md) | pending | — |

All five phases own disjoint files → fully parallelizable. No shared-file contention.

## File ownership (no overlap)

- P1: `apps/api/src/lib/logger.ts` (new), `apps/api/src/lib/error-alert.ts` (new), `apps/api/src/index.ts`, `apps/api/src/services/email-templates.ts` (add `ops_error_alert` kind), `apps/api/package.json`
- P2: `scripts/backup-db.sh` (+ blob tar step), `scripts/db-backup.sh` (delete), `scripts/db-restore.sh` (+ blob extract), `docs/prod-deploy-security-runbook.md` §5, `docs/ops/restore-drill-YYMMDD.md` (new)
- P3: `Jenkinsfile`, `scripts/ci-integration-tests.sh`
- P4: `eslint.config.js`
- P5: `docs/roadmap.md`, `docs/TEST_MATRIX.md`, `docs/stories/LMS-SESSION-EVIDENCE/validation.md`, `DEBT.md`, `.env.example`, other plan dirs' `plan.md` (status-only edits)

`index.ts` is P1-only; `Jenkinsfile` P3-only; `eslint.config.js` P4-only; runbook (P2) vs roadmap/TEST_MATRIX/DEBT/env (P5) are different files.

## Global success criteria

1. Prod errors produce structured logs + an alert email (via existing outbox) when error rate crosses threshold.
2. Backup runs automatically (cron on VPS) covering DB **and** local-disk blob stores (`.data/pdf`, `.data/session-photos`); one restore drill (DB + blobs) executed with recorded evidence.
3. A PR with a red integration test cannot merge (gate runs on PRs, not just `main`).
4. Raw `prisma` / `@prisma/client` import outside the whitelist fails lint.
5. Stale roadmap/TEST_MATRIX/DEBT/plan statuses reflect shipped reality; `.env.example` documents every read env var.

## Key cross-phase risks

- **Backup/restore format mismatch (P2, HIGH):** `db-restore.sh` uses `pg_restore` (custom `-Fc`, pairs with the
  deleted `db-backup.sh`), but the canonical `backup-db.sh` emits plain SQL (`--clean --if-exists`). Dedupe MUST
  realign restore to the plain-SQL/`psql` path or the drill silently fails. See P2.
- **Blob-store backup gap (P2, CRITICAL→mitigated):** `backup-db.sh` was DB-only; `.data/pdf` + `.data/session-photos`
  (referenced by DB rows) were never captured → DB-only restore leaves dangling refs. P2 now tars both store dirs on the
  same cron/retention; P5 re-surfaces the residual MinIO/S3-migration debt in DEBT.md so it stays visible.
- **CI cost + port safety on 2-vCPU VPS (P3, MED):** integration tests spin an ephemeral Postgres per PR. Serialization
  is guaranteed by `numExecutors: 1` (`jenkins-casc.yaml:4`), NOT `disableConcurrentBuilds()` (per-branch only). Watch
  build minutes; if executors ever increase, the hardcoded `55432` port becomes a collision risk — revisit then.
- **Single-instance state (P1):** error-rate counter is a process-level singleton (same topology caveat as
  `email-outbox.ts:96-100` and `rate-limit.ts`). A second API replica would undercount — documented, not fixed (YAGNI).

## Unresolved

- Report says "260626 prod-readiness ×2" but three prod-readiness plans exist (0133, 0949, 1413). P5 lists all three; operator confirms which are superseded by `260628-0147-prod-deployment`.
- Error-tracker: plan recommends env-gated Sentry SaaS SDK (no-op when `SENTRY_DSN` unset) over self-host. Confirm SaaS PII egress acceptable for student data, or keep pino+email-only. See P1.
