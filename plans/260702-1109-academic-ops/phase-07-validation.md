---
title: "P7 — Validation (int tests + e2e + migration 0-drift)"
phase: 7
status: pending
risk: high
owns: [apps/api/test/, e2e/]
---

# P7 — Validation

## Context
- Source: brainstorm §PLAN5 success criteria. Depends on P1–P6 complete.
- Anchors (verified): int-test harness `lmsCaller` `apps/api/test/helpers.ts` (used by `*.int.test.ts`); existing int tests e.g. `session-evidence-publish-to-lms.int.test.ts`.
- Migration policy: all phases are additive-or-no-schema → drift check must show 0 new required migrations beyond intended (most phases = 0 schema delta).

## Requirements
- Integration tests cover each phase's core invariant (list in steps).
- E2E smoke for the operator-facing flows (mark-all, transfer, PDF download, lifecycle block).
- Migration 0-drift verified on prod-mirror DB (`prisma migrate diff` / db-push drift check).

## Files
- Create: `apps/api/test/*.int.test.ts` for transfer, makeup, attendance-report, lifecycle-gate, pdf-authz.
- Modify/create: e2e specs for mark-all + transfer + PDF + lifecycle.
- No product code change.

## Implementation steps
1. P1: transfer preserves history, old=transferred, attendance guard holds.
2. P2: makeup created, conflict rejected, excluded from recompute.
3. P3: markAll idempotent+override+excused; report counts; parent per-session.
4. P4: parent downloads own child transcript/cert; IDOR rejected (403 other child); staff path intact.
5. P5: withdrawn login rejected; mid-session invalidation; attendance skips blocked; active unaffected.
6. P6: room update/archive persist; meeting setSchedule visible to parent; note persists.
7. Run full int suite + `lmsCaller` regression; confirm no auth regressions.
8. Migration drift: `prisma migrate diff` against prod-mirror = 0 unexpected; if any phase added a column, confirm its migration present + reversible.

## Tests / validation
- All int + e2e green.
- Drift report clean on prod-mirror.
- Harness: `story update` proof per phase + `trace` at close.

## Risks / rollback
- Risk (med): flaky LMS auth tests after P5 shared-package change → run auth suite explicitly.
- Risk (low): drift false-positive from unrelated pending migrations → baseline before P1.
- Rollback: tests only; no product rollback. Failing gate blocks merge.

## Blockers
- Depends on ALL of P1–P6.
