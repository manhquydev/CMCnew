# Phase 07 — Validation: parity + int + e2e + migration 0-drift

## Context links
- Brainstorm §5, §6; `docs/operate-and-test-guide.md` (migration/drift + live verify)
- Migration-chain lesson: `docs/journals/260701-2254-work-shift-migration-chain-fix-critical.md`
- Depends on: P1–P6 (all).

## Overview
- Date: 2026-07-02
- Description: Full regression across the round: permission parity snapshot, integration tests (exercise auto-open TZ, isolation, HR domain scoping, KPI SoD), e2e teacher-nav update (giao_vien loses exercise write), and migration 0-drift replay on prod-mirror.
- Priority: P1
- Implementation status: pending
- Review status: not started

## Key Insights
- Three layers of proof required by high-risk lane: unit (TZ helper, domain-guard matrix, gradeFromPercent), integration (auto-open, isolation, HR scoping, SoD), e2e (teacher nav no longer shows exercise write; director upload → LMS auto-open).
- Two behavior changes need snapshot/e2e sync: giao_vien loses exercise create/publish (P2), payroll re-owned to directors (P5). Parity snapshot MUST be regenerated and reviewed, not blindly accepted.
- `grading-weights-db-parity.int.test.ts` needed edits in P1/P2 (thresholds create removed :104-109; exercise create shape :70,:130-131) — confirm green here.

## Test inventory — old-shape Exercise + deleted procedures (M1, red-team-verified)
**8 files construct Exercise with `facilityId`/`classBatchId` — each needs the create call migrated to `(curriculumUnitId, type)` (no facilityId/classBatchId):**
| File | Lines | Action |
|------|-------|--------|
| `assessment-final-grade-publish.int.test.ts` | :48,60 | reshape create → curriculumUnitId+type; keep hw/test split |
| `badge-auto-award-idempotency.int.test.ts` | :74 | reshape create |
| `final-grade-term-scope.int.test.ts` | :49,59 | reshape create |
| `kpi-auto-prefill.int.test.ts` | :169,180 | reshape create |
| `guardian-principal-isolation.int.test.ts` | :276 | reshape create (also OTP-path migration from P6) |
| `grading-weights-db-parity.int.test.ts` | :70,130 | reshape create + thresholds-create removal (P1) |
| `lms-security-invariants.int.test.ts` | :48,128 | reshape create AND rewrite invariant #1 (below) |
| `lms-full-lifecycle-e2e.int.test.ts` | :198,336 | reshape create AND rewrite (below) |

**Two files need semantic rewrites, not just reshape:**
- `lms-full-lifecycle-e2e.int.test.ts:198-210,345` calls the DELETED procedures `staffCtx.exercise.create`/`publish` → rewrite to director `exercise.upsert` + session-end auto-open flow (mirror P2 openedUnit semantics).
- `lms-security-invariants.int.test.ts` invariant #1 (header :5-8) asserts exercise-RLS invisibility — a semantic P1 REMOVES. Redefine invariant #1 around join-based visibility (student sees exercise only after their session ends) + the C2 write-path guard (cross-class submit denied), NOT RLS.
- Budget: this is ~1 day, not a line item.

## Requirements
1. `pnpm typecheck` across all packages: zero errors, no `as any` around tRPC client (P6).
2. Permission parity snapshot regenerated; diff reviewed to match exactly the intended changes (exercise: -giao_vien +upsert; payroll: hr/ke_toan→directors; no unintended drift).
3. Integration tests green, including: the 8 reshaped Exercise-create files (inventory above); the 2 semantic rewrites (lifecycle-e2e → upsert+auto-open, security-invariants #1 → join-based); new P2 tests (TZ boundary, cross-student isolation, cancelled-session-no-open, cross-class submit denied, submit-before-open denied); new P5 tests (domain scoping matrix INCLUDING self-write block, KPI SoD preserved).
4. E2E: teacher account sees NO exercise create/publish/manager; director upload for a unit → enrolled student sees it auto-open only after that class's session ends. Playwright.
5. Migration chain replays from zero with 0 drift on prod-mirror: `prisma migrate reset` + `prisma migrate diff` per operate-and-test-guide; verify `exercise` has no RLS policy and `submission` retains isolation.
6. Harness: `harness-cli story update` proof status for each workstream; `harness-cli trace` at close; high-risk story `validation.md` filled with evidence links.

## Architecture
- Verification order (fail fast): typecheck → unit → parity snapshot → integration → migration replay → e2e → live smoke (optional, per operate-and-test-guide seed accounts).

## Related code files
- `apps/api/test/` — parity/permission snapshot, exercise int tests (new), payroll domain-scope tests (new), `guardian-principal-isolation.int.test.ts` (P6), `grading-weights-db-parity.int.test.ts` (P1/P2 edits).
- e2e (Playwright) specs — teacher-nav, director-upload→LMS-auto-open.
- `packages/db/prisma/migrations/` — replay target.

## Implementation Steps
1. Run typecheck; fix any residual.
2. Regenerate + review parity snapshot; assert intended diff only.
3. Run full int suite; author missing auto-open/isolation/domain-scope/SoD tests if not added in P2/P5.
4. `migrate reset` on prod-mirror; `migrate diff` = empty; verify RLS state via `pg_policies`.
5. Run/update e2e teacher-nav + auto-open flows.
6. Optional live smoke via seed accounts (operate-and-test-guide).
7. Update harness story proof + trace + high-risk validation.md.

## Todo list
- [ ] typecheck all packages clean
- [ ] parity snapshot regenerated + diff reviewed
- [ ] 8 Exercise-create test files reshaped (inventory) green
- [ ] lifecycle-e2e rewritten to upsert+auto-open; security-invariants #1 redefined join-based
- [ ] int suite green (incl. new TZ/cancelled/cross-class-submit/isolation/domain-scope+self-write/SoD tests)
- [ ] migration replay 0-drift on prod-mirror; RLS state verified (exercise no policy + RLS disabled)
- [ ] e2e teacher-nav (grading.tsx no create/publish) + director-upload→auto-open green
- [ ] harness story/trace/validation.md updated

## Success Criteria (maps to plan.md global criteria)
- All 4 global success criteria demonstrably met with test/evidence links.
- 0-drift migration replay confirmed; no orphaned RLS policy on exercise; submission isolation intact.
- Parity snapshot diff contains ONLY the intended authorization changes.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Parity snapshot rubber-stamped, hiding an unintended perm change | Med | High | Manual line-by-line diff review; assert exact expected changes only. |
| TZ auto-open passes in CI TZ but fails in ICT prod | Med | High | Tests pin Asia/Saigon explicitly; do not rely on machine TZ. |
| Migration replays in dev but drifts on prod-mirror | Med | High | Run against prod-mirror per guide, not just local; the work-shift lesson. |
| e2e teacher-nav flaky on gated UI | Low | Med | Assert on server FORBIDDEN + absence of UI affordance, not timing. |

## Security Considerations
- This phase is the gate that proves the two authorization changes (exercise narrowing, payroll re-own) and the RLS removal did not open a hole. Do not sign off without cross-student isolation + cross-domain FORBIDDEN evidence.

## Next steps
- On green: PR develop→main (per AGENTS.md branch workflow). Rollback plan = revert the round's commits; migrations reversible (D4 data-safe).
