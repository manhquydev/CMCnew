# Phase 01 — Data model: Exercise restructure + drop GradingThreshold

## Context links
- Brainstorm: `plans/reports/brainstorm-260702-0929-lms-erp-seam-fixes-report.md` (D1, D4, D5, §4 W1/W3)
- Decision precedent: `docs/decisions/0021-curriculum-unit-global-no-rls.md`
- Migration-chain lesson: `docs/journals/260701-2254-work-shift-migration-chain-fix-critical.md`
- Migration/drift procedure: `docs/operate-and-test-guide.md`

## Overview
- Date: 2026-07-02
- Description: Move `Exercise` from a per-class RLS-scoped row to a global curriculum asset hanging off `CurriculumUnit` (no RLS, mirroring `course`/`curriculum_unit`). HARD-DELETE legacy exercises + their submissions (D4: prod has no real submissions). Drop `GradingThreshold` model. Update seeds. Keep `Submission` per-student RLS (isolation shifts to submission side).
- Priority: P1
- Implementation status: pending
- Review status: not started

## Key Insights
- `Exercise` today (`schema.prisma:600-622`): `facilityId Int`, `classBatchId` FK→ClassBatch (onDelete Restrict), `submissions Submission[]`, `@@index([facilityId])`, `@@index([classBatchId])`. It is under RLS (`exercise_isolation`, per `exercise.ts:22-23` comment).
- `Submission` (`schema.prisma:625-645`): already has `facilityId` + `studentId` + `@@unique([exerciseId, studentId])`, `onDelete: Cascade` from Exercise. This is where per-student isolation must now live.
- `ClassSession` (`schema.prisma:324-349`) already carries `curriculumUnitId String?` FK (→CurriculumUnit, onDelete SetNull) plus `sessionDate @db.Date` + `startTime`/`endTime` String "HH:mm". This is the join key for auto-open (used in P2) — no schema change needed here.
- `GradingThreshold` (`schema.prisma:887-901`) is **NOT purely write-only** as brainstorm §1 stated: it is created in `seed-demo.ts:59-84` (const THRESHOLDS + `thresholds: { create }`), in the parity test `apps/api/test/grading-weights-db-parity.int.test.ts:104-109`, and is a relation on `GradingTemplate` (`schema.prisma:877 thresholds GradingThreshold[]`). Dropping it touches all four sites. `gradeFromPercent` in `packages/domain-grading/src/grading.ts` is a PURE function (no DB read of thresholds) → KEEP it + its tests (D5).
- The parity test also creates an `Exercise` with `facilityId + classBatchId` (`grading-weights-db-parity.int.test.ts:70` AND `:130-131`) → the Exercise restructure will break these create calls; fix in P2/P7 test updates (full 8-file inventory in P7), flag here as cross-phase.

## Requirements
1. Add `curriculumUnitId String @db.Uuid` FK on `Exercise` → `CurriculumUnit` (onDelete Restrict — keep audit). Add relation on `CurriculumUnit`.
2. Remove per-class binding: drop `classBatchId`/`batch` relation, `facilityId`, and `dueAt` from `Exercise` (global asset, no deadline — see Validation Summary NO-dueAt decision). Drop `@@index([facilityId])`/`@@index([classBatchId])`; add `@@index([curriculumUnitId])`. Add composite unique `@@unique([curriculumUnitId, type])` (one homework AND optionally one test per unit — operator-final).
3. **RLS removal (C1 — outage trap)**: the new migration must contain BOTH `DROP POLICY exercise_isolation ON exercise;` AND `ALTER TABLE exercise DISABLE ROW LEVEL SECURITY;`. The app connects as non-owner `cmc_app` (`packages/db/src/index.ts:20`); dropping the policy while RLS stays ENABLED = Postgres default-deny → every exercise read/write silently returns empty (total outage). The enable-loop lives inside the ALREADY-APPLIED migration `20260623090658_phase2_lms_core/migration.sql:275-287` — do NOT edit that historical loop (would diverge replay-from-zero vs applied prod). Keep GRANTs.
4. `Submission`: confirm it retains `facilityId` + `submission_isolation` RLS policy (already exists independent of Exercise: `20260623100000_principal_aware_rls/migration.sql:53-61`). Read-side isolation is safe; the WRITE path is patched in P2 (C2). No new submission RLS work here.
5. **HARD-DELETE legacy data (C3/D4)**: `DELETE FROM submission WHERE exercise_id IN (SELECT id FROM exercise WHERE curriculum_unit_id IS NULL);` then `DELETE FROM exercise WHERE curriculum_unit_id IS NULL;` — BEFORE `SET NOT NULL` + composite unique. Prod has no real submissions (D4). This resolves the NOT-NULL-vs-archived-NULL contradiction and unblocks the plain composite unique (no partial index, 0-drift preserved). No soft-archive.
6. Drop `GradingThreshold`: remove model + `GradingTemplate.thresholds` relation (`schema.prisma:877`); migration `DROP TABLE grading_threshold`.
7. Update `seed-demo.ts`: remove `THRESHOLDS` const (:59) + `thresholds: { create }` (:83). Update any `Exercise` seed create to use `curriculumUnitId` instead of `classBatchId`/`facilityId`.
8. **Rework `seed-lms.ts` exercise block (M2)**: `seed-lms.ts:146-166` today creates a homework + `test_periodic` PER CLASS BATCH — under global per-unit exercises this (a) collides when two batches teach the same course/unit and (b) needs the hw and test on the SAME unit (now allowed by composite unique `(unit,type)`). Rewrite to create exercises keyed by curriculum unit (not batch): one `homework` + optionally one `test_periodic` per unit. Assessment hw/test split (`assessment.ts:219-222`) stays unchanged. The badge `thresholds` at :193 is unrelated — do NOT touch.

## Architecture
- Data-flow (new): `CurriculumUnit (global) 1─* Exercise (global, no RLS)`; `Exercise 1─* Submission (RLS by facilityId+studentId)`; `Grade 1─1 Submission`. Isolation boundary moves from Exercise to Submission.
- Migration ordering (single replayable chain, additive → delete → constrain → destructive). Order matters for C3:
  1. `add_exercise_curriculum_unit` — add nullable `curriculum_unit_id` + FK + index (additive).
  2. `purge_legacy_exercises` — `DELETE FROM submission WHERE exercise_id IN (SELECT id FROM exercise WHERE curriculum_unit_id IS NULL)` then `DELETE FROM exercise WHERE curriculum_unit_id IS NULL` (hard-delete, D4). After this NO NULL rows remain.
  3. `exercise_unit_constraints` — `SET NOT NULL` on `curriculum_unit_id` + composite `UNIQUE(curriculum_unit_id, type)`. Safe now (step 2 removed NULLs; plain unique, no partial index → 0-drift).
  4. `exercise_global_no_rls` — `DROP POLICY exercise_isolation ON exercise` AND `ALTER TABLE exercise DISABLE ROW LEVEL SECURITY` (C1, both statements); then drop `class_batch_id`/`facility_id`/`due_at` columns + old indexes. NEVER touch the historical enable-loop in `20260623090658_phase2_lms_core`.
  5. `drop_grading_threshold` — drop table.
- Keep each migration small; NO plan/phase IDs in migration names (stable-artifacts rule).

## Related code files
- `packages/db/prisma/schema.prisma` — Exercise :600, Submission :625, GradingTemplate :866, GradingThreshold :887, ClassSession :324 (read-only ref).
- `packages/db/prisma/migrations/` — new migration dirs (verify latest tenancy/RLS migration for the enable-loop location).
- `packages/db/src/seed-demo.ts` — THRESHOLDS :59, thresholds create :83.
- `packages/db/src/seed-lms.ts` — verify exercise seed shape.
- `packages/domain-grading/src/grading.ts` + `grading.test.ts` — KEEP unchanged (pure fn).

## Implementation Steps
1. Locate the tenancy/RLS migration containing the RLS-enable loop + `exercise_isolation`; confirm `course`/`curriculum_unit` exclusion pattern to mirror.
2. Edit `schema.prisma`: Exercise (add curriculumUnitId, drop classBatchId/facilityId/old indexes), CurriculumUnit (add `exercises Exercise[]`), GradingTemplate (drop thresholds relation), delete GradingThreshold model.
3. Author the 5 migrations above by hand (raw SQL for legacy hard-delete + RLS DROP POLICY/DISABLE + column drops; Prisma can't express RLS).
4. Update `seed-demo.ts` + `seed-lms.ts`.
5. Run `prisma generate`; run `prisma migrate reset` on a scratch DB to prove replay-from-zero.
6. Run `prisma migrate diff` to confirm 0 drift schema↔migrations.

## Todo list
- [ ] Schema edits (Exercise: +curriculumUnitId, drop classBatchId/facilityId/dueAt, composite `@@unique([curriculumUnitId,type])`; CurriculumUnit; GradingTemplate; drop GradingThreshold)
- [ ] 5 migrations authored + named without plan IDs (add col → purge legacy → constraints → no-RLS+drop cols → drop threshold)
- [ ] RLS: DROP POLICY + DISABLE ROW LEVEL SECURITY both present; historical enable-loop untouched
- [ ] Submission isolation policy confirmed (already exists; no change)
- [ ] Legacy exercise+submission HARD-DELETE migration
- [ ] seed-demo.ts + seed-lms.ts reworked (exercises keyed by unit, hw+test per unit)
- [ ] `prisma generate` clean; reset replay 0-drift; migrate diff empty

## Success Criteria
- `prisma migrate reset` on empty DB completes with no error; `prisma migrate diff --from-migrations --to-schema-datamodel` reports no diff.
- `exercise` table has no RLS policy; `pg_policies` shows none for it; `submission` still has isolation policy.
- No `grading_threshold` table; `pnpm --filter @cmc/domain-grading test` still green (pure fn kept).
- Seeds run without referencing dropped columns/model.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dropping Exercise.facilityId removes the join RLS relied on → student data leak via submission | Med | High | Add/verify explicit `submission_isolation` RLS on `facilityId` BEFORE dropping Exercise columns; int-test cross-facility submission read denial (P7). |
| `SET NOT NULL` / composite unique fails on prod-mirror seeded data (work-shift failure mode) | High | High | Hard-delete NULL-unit rows (migration step 2) BEFORE constrain (step 3); replay verified on prod-mirror in P7, not just empty local. |
| Hard-delete removes a row an operator wanted kept | Low | Med | D4 authorizes: prod has no real submissions; legacy exercises are per-class scaffolding with no curriculum unit. Rollback = revert migrations + re-seed. |
| Migration chain non-replayable (work-shift lesson) | Med | High | Author additive-first; test `migrate reset` from zero; keep destructive steps late; verify on prod-mirror. |
| GradingThreshold drop breaks parity test create block | High | Low | Coordinated edit in P7 test updates; noted here as cross-phase. |

## Security Considerations
- Decision A invariant: `exercise` has NO RLS backstop → EVERY write path MUST be app-layer permission-gated (enforced in P2, incl. submission write path). Document the invariant in the Exercise model comment (mirror curriculum_unit comment).
- **Decision A record must state**: removing exercise RLS loosens the `/files/exercise/:ref` file-serving semantics from enrolled-classes scoping to any-authenticated-principal. Acceptable — worksheets carry no PII (academic content only). Make this explicit in the Decision A durable record.
- No new PII exposed: Exercise carries only academic content; student data stays on Submission (RLS-scoped).

## Next steps
- Hand curriculumUnitId + global-no-RLS shape to P2 (API auto-open + upsert). P2 depends on this phase.
- Rollback: revert the 5 migrations in reverse; re-add `exercise_isolation` policy + `ENABLE ROW LEVEL SECURITY` + dropped columns from git history; re-seed. Because prod has no real submissions (D4), the hard-delete is data-safe.
