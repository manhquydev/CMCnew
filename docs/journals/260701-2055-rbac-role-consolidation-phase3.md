# RBAC Role Consolidation Phase 3 Complete, Phase 4 Pending

**Date**: 2026-07-01 14:30
**Severity**: High
**Component**: RBAC, Permissions Registry
**Status**: Partially Complete (Phase 1-3 done, Phase 4 pending)

## What Happened

Implemented Phase 1-3 of RBAC role consolidation: consolidated 12 roles to 9 by removing quan_ly, head_teacher, bgd.

Phase 3 deployed enum migration to cmcnew-prod-postgres-1, removing 3 obsolete Role enum values.

Discovered unrelated but critical issue: work-shift tables never had CREATE TABLE migrations committed.

## The Brutal Truth

This was exhausting but necessary work. The fact that we had to verify 40+ touchpoints just to remove 3 redundant roles speaks to organizational debt.

The real frustration: discovering the work-shift migration issue during RBAC rollout meant we could not validate Phase 3 on prod. It derailed the deployment sequence.

## Technical Details

**Consolidated Roles** (12 to 9):
- Removed: quan_ly, head_teacher, bgd (now director functions)
- Kept: giao_vien, giam_doc_dao_tao, giam_doc_kinh_doanh, sale, ke_toan, hr, cskh, ctv_mkt, super_admin

**Phase Completion**:
- Phase 1: Discovery (0 real users on removed roles) [OK]
- Phase 2: Permissions registry remap (40+ touchpoints) [OK]
- Phase 3: Prisma enum migration deployed [OK]
- Phase 4: Full verification, E2E re-run, docs update [PENDING]

**Multi-Role Support** (already in place):
- AppUser.roles: Role[] (array of roles)
- AppUser.primaryRole: Role (default role)

**Cross-Check with Finance Controls**:
- finance.receiptApprove/Cancel/Reconcile now includes giam_doc_kinh_doanh as co-approver alongside ke_toan
- DIRECTOR_ROLE_GRANTS gap: only super_admin could create ke_toan/hr accounts (bottleneck)

## Root Cause Analysis

Not a failure of the plan (Phuong an C was correct). Blocked by unrelated work-shift migration issue surfaced during Phase 3.

Underlying concern: consolidating roles is a breaking change. If enum migration succeeds but RLS migrations fail, prod left in inconsistent state.

## Lessons Learned

1. Role consolidation is reversible if you soft-archive instead of removing.
2. Multi-environment deployment must validate schema consistency.
3. Cross-domain feature dependencies must be discovered early.
4. Phase gate discipline prevents cascading failures. Phase 3 should not have deployed until Phase 4 was green.
5. Financial controls must be re-verified when roles change.

## Next Steps

1. Create missing CREATE TABLE migration for work-shift tables
2. Test locally: prisma migrate deploy against fresh DB
3. Deploy to cmcnew-prod-postgres-1 alongside RBAC rollout
4. Run complete E2E test suite (Phase 4)
5. Fix DIRECTOR_ROLE_GRANTS: add ke_toan, hr to allow directors to create accounting/HR staff
6. Update docs/permissions with 9-role structure

## Files Modified

- packages/auth/src/permissions.ts — registry remap, DIRECTOR_ROLE_GRANTS pending
- packages/db/prisma/schema.prisma — enum migration removes 3 Role values
- 40+ app files: routers, admin panels, seed scripts, tests
- All permission-parity tests passing

## Related Issues

- [[work-shift-missing-create-table-migration]] — blocks Phase 4
- [[erp-rebuild-build-progress]] — both shipped 2026-07-01
