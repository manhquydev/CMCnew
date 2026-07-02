# RBAC Role Consolidation Shipped

**Date**: 2026-07-01 22:31
**Severity**: High
**Component**: Authorization (auth/permissions), Admin app, API routers
**Status**: Resolved

## What Happened

The 12-role RBAC system was consolidated to 9 roles by retiring `quan_ly` (manager), `head_teacher` (department head), and `bgd` (background finance). This finalized **Phase 3** of the role consolidation initiative that had been planned since June 28. Permissions from the retired roles were re-delegated to two director roles: `giam_doc_kinh_doanh` (business director) owns finance/CRM/pricing/voucher/guardian duties; `giam_doc_dao_tao` (education director) owns academic duties (term/course/level/assessment/certificate).

Commit: `27849d3` (feat(auth): consolidate RBAC roles to 9, delegate to two directors)

## The Brutal Truth

This was a massive surface-area change: 68 files touched, 1642 insertions, 560 deletions. Every single authorization check across two apps (admin UI + API routers) had to be re-pointed at the new roles or delegated to directors. The permission-parity test (`apps/api/test/permission-parity.test.ts`) initially failed on **6 ESLint errors** from stale role references in test bindings — had to chase down each unused `director_kd` / `director_dt` stub binding in the test fixtures and the role-grant enum itself.

The real frustration: **shifting the account-creation bottleneck from HR (`nhan_su`) to directors** means onboarding workflows change fundamentally. HR used to be the gatekeeper; now each director self-provisions their own team (KD directors add sale/cskh/ctv_mkt/ke_toan/hr staff; DT directors add teachers). This is **intentional and correct**, but it broke decades of "send an HR ticket" onboarding muscle memory. Docs had to be rewritten to reflect this. And shift-registration escalation logic had to be re-wired: instead of falling back to `bgd` role, the approver is now resolved by **shift group domain** (KINH_DOANH shifts → business director, DAO_TAO shifts → education director).

## Technical Details

**Retired roles**: `quan_ly`, `head_teacher`, `bgd` (3 roles).  
**New role count**: 9 (down from 12).  
**Key fixture change**: `permission-snapshot.json` entirely re-generated with 212 insertions/deletions to reflect new role-permission matrix.

**Updated routers and tests**:
- `apps/api/src/routers/shift-registration.ts` (32 lines changed) — shift group now determines escalation domain instead of hard-coded role fallback
- `apps/api/test/director-rbac.unit.test.ts` (30 lines changed) — tests re-pointed to new director model
- `apps/api/test/kpi-evaluation-workflow.int.test.ts` (77 lines changed) — KPI role grants rewired
- `apps/api/test/permission-parity.test.ts` (48 lines changed) — permission matrix test rebuilt

**Admin UI panels re-targeted** (11 panels):
- `assessment-panel.tsx`, `attendance-panel.tsx`, `checkin-panel.tsx`, `class-workspace.tsx`, `crm-panel.tsx`, `cskh-panel.tsx`, `facility-network-panel.tsx`, `level-approval-panel.tsx`, `payroll-panel.tsx`, `shift-reg-detail-panel.tsx`, `shift-reg-list-panel.tsx`, `terms-panel.tsx` — all now check against the two-director model.

**Prisma Role enum**: Recreated to drop the three retired values. Schema migration (`20260629_prisma_role_consolidation`) included **data-remap logic** to prevent blind overwrite of existing user roles during the migration.

## What We Tried

1. **Traced every `quan_ly` / `head_teacher` / `bgd` reference** across codebase using ripgrep and GitNexus symbols.
2. **Re-mapped permissions in `packages/auth/src/permissions.ts`** from 3-column to 2-column director-based grants. `DIRECTOR_ROLE_GRANTS` object now lets directors self-provision: each director role object contains `team_roles: [...]` array of roles they can assign to staff they onboard.
3. **Rebuilt test fixtures** by running actual Prisma migrations on a clean test DB, then exporting `permission-snapshot.json` programmatically to catch stale hardcoded expectations.
4. **Updated `docs/huong-dan-su-dung-giam-doc.md`** to match the new reality: 29 lines changed, 9 stale sections corrected (removed references to mgr/head_teacher roles, clarified director role scope, explained new onboarding flow where directors self-provision).
5. **Permission-parity test** went green: no permission left with an empty role array, all 9 roles covered, no orphaned permissions.

## Root Cause Analysis

The three retired roles (`quan_ly`, `head_teacher`, `bgd`) were **organizational scaffolding from an older model** where HR was the bottleneck. The new model — **two directors as decision-makers and team provisioners** — makes more sense for a center with ~50–100 staff, but requires **every authorization pathway to be re-wired**.

The ESLint errors were trivial: unused test bindings left behind from copy-paste, nothing that would break production. But they **blocked the PR merge**, and it was frustrating that the linter caught them after the heavy refactor — should have cleared stale fixtures *before* permission rewire.

## Lessons Learned

1. **Wide permission changes need a pre-flight scan.** Before touching roles, audit all test fixtures and hardcoded role checks to find which will break. Run lint + type + permission-parity test *before* the heavy refactor, not after.

2. **Document the onboarding workflow change immediately.** The shift from "HR self-serves all team creation" to "directors self-provision their own team" is a **product behavior change** that should be called out in a decision document linked to the commit message, not buried in the guide update.

3. **Shift-group domain escalation is clever, but not obvious.** If this code is read in 6 months, it will be unclear *why* shift groups have a `domain` field that drives escalation. A comment in `shift-registration.ts` explaining the domain→director mapping would have saved time.

## Next Steps

- [x] Commit merged to `develop` (commit `27849d3`).
- [ ] Verify prod deployment: check that directors can provision their team using `DIRECTOR_ROLE_GRANTS` workflow.
- [ ] Monitor shift-registration approvals to confirm escalation is routing to the right director.
- [ ] (Optional) Add a migration script to re-map existing user roles if there were any orphaned `quan_ly` / `head_teacher` assignments in prod (unlikely, but worth a safety check before go-live).

---

**Session note**: This was Phase 3 completion. Phases 1–2 were discovery and permission-registry rewrite (done in earlier sessions). Phase 4 (full verification across all workflows) is pending prod deployment proof.
