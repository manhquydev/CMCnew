# ERP/LMS Seam Fixes Exec Plan

## Status

In progress from plan `plans/260702-0929-lms-erp-seam-fixes/plan.md`.

## Steps

1. Record high-risk Harness intake, story packet, and durable story row.
2. P1: Reshape Exercise schema/migrations, remove GradingThreshold, update seeds, and prove migration replay.
3. P2: Rewrite exercise API visibility/upsert, submission write guards, and exercise permissions.
4. P3: Add director per-unit exercise UI and remove teacher create/publish UI.
5. P4: Adapt LMS exercise views to flattened shape and no-due behavior.
6. P5: Re-own payroll to directors, add write-domain scoping, UI forms, nav fix, and Decision B.
7. P6: Wire cleanup items: classBatch.update UI, tRPC de-casts, remove parent password login, gate showcase, and debt doc.
8. P7: Run parity, typecheck, integration, migration drift, and E2E validation; update proof.

## Risks

- Exercise RLS removal has no DB backstop; write paths must be permission-gated and read/write visibility must be join-proven.
- Migration order can cause drift or default-deny outage if RLS is dropped incorrectly.
- P2 and P5 both edit `packages/auth/src/permissions.ts`; serialize those edits.
- Removing casts may expose existing type drift.

## Rollback

Revert the round's code and migration commits as a unit. If already applied to an environment, restore Exercise RLS and old columns from git history, re-seed demo Exercise rows, and mark the new decisions superseded.
