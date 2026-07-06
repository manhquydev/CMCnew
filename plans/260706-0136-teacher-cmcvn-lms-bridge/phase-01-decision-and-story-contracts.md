---
phase: 1
title: "Decision and story contracts"
status: complete
effort: "M"
---

# Phase 1: Decision and story contracts

## Overview

Lock the product and architecture contracts before implementation. This phase prevents the work from accidentally becoming a second LMS, bypassing accepted student provisioning rules, or weakening RLS/authz.

Governing rules to preserve:

- Admin SPA routing stays path-based per decision 0016.
- CurriculumUnit is global without RLS per decision 0021.
- Exercise is a global curriculum-unit asset without RLS per decision 0022; writes are app-layer gated.
- Origin TLS and dev/prod split follow decisions 0029 and 0032.
- Student/family LMS login follows decision 0033: parent phone `84xxx` + family profile picker + default password `Cmc2026@`.
- Class code follows decision 0036: `[Facility.code]-[ProgramAbbrev]-[YY]-[seq]`.

## Implementation Steps

1. Create the high-risk story docs from `docs/templates/high-risk-story/` under `docs/stories/TEACHER-CMCVN-LMS-BRIDGE/`.
2. Record Harness intake/story/trace entries for the plan, red-team, validation, implementation, tests, review, docs, and deployment.
3. Add or update a decision only after validation confirms the parent+student one-form invariant:
   - MVP default: director one-form creates a draft/provisioning request and existing `receiptApprove` remains the normal student activation path.
   - Expanded option: director one-form can create `Student`, `ParentAccount`, `Guardian`, and `StudentAccount` directly for LMS launch only after explicit user decision.
4. If the expanded direct option is accepted, require first-class direct-intake provenance before implementation:
   - either new schema fields/request table for `Student` and `Enrollment` provenance,
   - or a durable provisioning request that can drive rollback/reporting.
   Audit text alone is not enough.
5. Decide director setup authority before implementation:
   - one director role gets end-to-end setup permission, with permission registry/tests/docs updated,
   - or the product explicitly accepts KD/DT handoff for class creation and enrollment.
6. If the expanded direct option is accepted, create `docs/decisions/0038-director-lms-intake-provisioning.md` and update `docs/DECISION_INDEX.md` with the API/UI files it governs.
7. Restate the governing decision before editing any matched files:
   - `apps/api/src/routers/lms-auth.ts`, `apps/api/src/trpc.ts` are governed by 0033.
   - `apps/api/src/routers/exercise.ts`, `schema.prisma` are governed by 0022.
   - `packages/domain-academic/src/code.ts`, `apps/api/src/services/batch-code.ts`, `schema.prisma` `BatchCodeCounter` are governed by 0036.
8. Define the implementation test list before coding:
   - API integration tests for direct/draft parent+student provisioning.
   - API integration tests for guardian/student account RLS and duplicate parent phone/email.
   - API tests for direct-intake rollback/provenance or provisioning-draft lifecycle.
   - Permission tests for `giao_vien`, `giam_doc_kinh_doanh`, `giam_doc_dao_tao`.
   - UI/e2e smoke for director setup, teacher day, parent view, student homework.
   - Deploy smoke for `teacher` and existing dev/prod domains; `devteacher` only if accepted.
9. Define rollback:
   - Feature can be disabled by removing teacher vhost/nav shortcuts without deleting existing ERP/LMS behavior.
   - New data path must be idempotent and auditable before rollout.

## Success Criteria

- [x] High-risk story docs exist or the plan explicitly records why they are deferred.
- [x] Harness evidence exists for plan creation and validation.
- [x] Parent+student one-form decision is accepted before any implementation touches provisioning code.
  - Implemented path preserves existing receipt/provisioning ownership; no direct active-student intake code was added.
- [x] Director setup authority decision is accepted before permission changes.
  - No broad director permission expansion was added in this story.
- [x] MVP preserves receipt/provisioning seam unless user explicitly accepts direct active-student creation.
- [x] Decision index is updated only if a backing decision doc exists.
  - No new decision doc/index row was needed because direct intake and role expansion were not implemented.
- [x] Test matrix is written into relevant phases before coding starts.
- [x] No phase asks to create a separate app/database/auth system.

## Status Update - 2026-07-06

Phase 1 is complete for this MVP. The active implementation chose the plan defaults: reuse the existing admin/API/LMS stack, preserve receipt/provisioning invariants, defer `devteacher`, and avoid a new direct-intake decision.

## Risks And Guards

- Risk: direct parent+student creation contradicts decision 0033. Guard: no implementation until validation confirms a superseding/additive decision.
- Risk: plan edits drift from code reality. Guard: red-team and validate must cite code paths with `file:line` evidence.
- Risk: project docs become stale. Guard: docs update is phase 7, after implementation facts are known.
