# Phase 05 — HR split: re-own payroll to directors + domain scoping + UI + Decision B

## Context links
- Brainstorm §4 W2, D3
- RBAC precedent being partially reversed: `docs/decisions/` RBAC Phương án C (kept hr/ke_toan ownership) — memory `rbac-role-consolidation-decision`.
- Scoping pattern reference: `apps/api/src/lib/kpi-authz.ts`.

## Overview
- Date: 2026-07-02
- Description: Move payroll/compensation permissions from `['hr','ke_toan']` (roles nobody holds) to the two directors, with handler-level domain scoping: target staff with role `giao_vien` → `giam_doc_dao_tao`; else → `giam_doc_kinh_doanh`; `super_admin` bypass. Wire `profileUpsert` + `rateCreate` forms into existing HR/payroll panels. Fix nav gate. Write Decision B.
- Priority: P1
- Implementation status: pending
- Review status: not started

## Key Insights
- `permissions.ts:172-202` payroll module: 20+ actions all `['hr','ke_toan']` (roster, profileUpsert, profileList, rateCreate, rateList, commissionForSale, payslip*, listByStaff, kpiEvalStart/AutoPrefill/SetAuto, syncCallMetrics). No staff holds hr/ke_toan (brainstorm §2) → entire surface dead.
- KPI confirm≠approve MUST be preserved: `kpiEvalConfirm`/`kpiEvalApprove` (`permissions.ts:195-196`) already = the two directors, and `kpiEvalApprove` blocks the confirmer (separation of duties). Data-prep actions (`kpiEvalStart`/`kpiAutoPrefill`/`kpiSetAuto`, :194,199-200) currently hr/ke_toan → must move to directors too (else still dead) but keep confirm/approve SoD intact.
- Module-level `permissions.ts` gates by role ANY-match (`permissions.ts:347`). It cannot express "director X may only touch staff in domain Y" — that is per-target, so **domain scoping must be a handler-level check**, not a permission entry. Reuse the `kpi-authz.ts` shape.
- nav gate bug: `nav-permissions.ts:92` — `hr` nav = `payroll.payslipList` (a procedure NO UI calls) → change to `payroll.roster` (the panel's real primary load). `nav-permissions.ts:97` `kpi` = `payroll.kpiList` — after re-own, kpiList must include directors so the nav resolves for them.

## Requirements
1. `permissions.ts` payroll module: replace `['hr','ke_toan']` with `['giam_doc_kinh_doanh','giam_doc_dao_tao']` for all payroll/compensation/kpi-prep actions. Keep `kpiEvalConfirm`/`kpiEvalApprove` as-is (already directors) and keep the approve≠confirm handler guard untouched. Update `kpiList`/`kpiEvalGet` to directors (drop hr/ke_toan). Regenerate snapshot. (SHARED file with P2 — serialize: land P2's exercise edit first, then this.)
2. Handler-level domain scoping helper (mirror `kpi-authz.ts`): given actor roles + target staff, allow iff (super_admin) OR (target has `giao_vien` role AND actor has `giam_doc_dao_tao`) OR (target has no `giao_vien` role AND actor has `giam_doc_kinh_doanh`). **PLUS self-target block (M5, operator-final)**: a director CANNOT `profileUpsert`/`rateCreate` on their OWN staff record — `actor.staffId === target.staffId` → FORBIDDEN (the other director or super_admin must). Mirrors the KPI confirm≠approve separation-of-duties pattern applied to money. Apply to `profileUpsert`, `rateCreate`, and other per-staff mutations. Read-only list actions (`profileList`, `rateList`, `roster`, …): **director-any — both directors see ALL staff** (RESOLVED, operator 2026-07-02: executive-board transparency, small-business fit; only WRITES are domain-scoped + self-blocked).
3. Wire `profileUpsert` + `rateCreate` forms into the existing HR/payroll panel(s) in admin (currently backend-only). Use `@cmc/ui` notify/validators.
4. Fix `nav-permissions.ts:92` → `payroll.roster`; verify `:97` kpi nav resolves for directors.
5. Decision B record from `docs/templates/decision.md`: HR/payroll ownership → two directors + domain scoping + **self-write block** (a director cannot write their own profile/rate; other director or super_admin must — SoD on money); explicitly note partial reversal of Phương án C (which kept hr/ke_toan). `harness-cli decision add`.

## Architecture
- Authz layered: (a) module permission = "is a director" (coarse, permissions.ts); (b) handler domain guard = "is the RIGHT director for this target" (fine, per-target). super_admin bypasses both.
- Data-flow (profileUpsert): actor session → requirePermission(payroll.profileUpsert) [director?] → load target staff roles → domainGuard(actor, target) → upsert + audit.

## Related code files
- `packages/auth/src/permissions.ts:172-202` — payroll module (SHARED with P2).
- permission snapshot/parity test in `apps/api/test`.
- `apps/api/src/routers/` payroll router (find; apply domain guard to profileUpsert/rateCreate handlers).
- `apps/api/src/lib/kpi-authz.ts` — pattern to mirror; consider a shared `payroll-authz.ts`.
- `apps/admin/src/nav-permissions.ts:92,97`.
- `apps/admin/src/payroll-panel.tsx` (+ compensation-panel.tsx) — host profileUpsert/rateCreate forms.

## Implementation Steps
1. Edit permissions.ts payroll module → directors; keep confirm/approve; regen snapshot.
2. Add `payroll-authz.ts` domain guard (mirroring kpi-authz); unit test the matrix.
3. Apply guard in profileUpsert/rateCreate (and other per-staff writes) handlers + audit.
4. Wire forms into payroll/compensation panels.
5. Fix nav-permissions :92 → roster; confirm :97.
6. Write Decision B; `harness-cli decision add`.

## Todo list
- [ ] permissions.ts payroll re-own (directors), confirm/approve preserved, snapshot regen
- [ ] payroll-authz domain guard + self-target block + matrix unit tests
- [ ] guard applied to profileUpsert/rateCreate handlers + audit
- [ ] profileUpsert/rateCreate forms wired into panels
- [ ] nav-permissions :92 → roster; :97 verified
- [ ] Decision B written (incl. self-write block) + harness decision add

## Success Criteria
- Training director creates profile+rate for a giao_vien; business director for sale — cross-domain attempt returns FORBIDDEN (int test).
- Self-write blocked: a director's `profileUpsert`/`rateCreate` on their OWN record returns FORBIDDEN; the other director (or super_admin) succeeds (matrix test).
- KPI confirm≠approve still enforced (existing test green).
- HR nav resolves for directors via `payroll.roster`; no dead nav pointing at payslipList.
- Parity snapshot + typecheck green.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Merge conflict / double-edit of permissions.ts with P2 | High | Med | Serialize: P2 exercise module first, then P5 payroll; single owner of the file per commit. |
| Domain guard mis-scopes (e.g., multi-role staff giao_vien+sale) | Med | High | Rule: presence of `giao_vien` role routes to gd_dt; unit-test multi-role targets explicitly; document tie-break in Decision B. |
| Breaking KPI SoD while moving kpi-prep perms | Med | High | Do not touch kpiEvalConfirm/Approve entries or their handler guard; regression test SoD. |
| Reversing a user decision (Phương án C) silently | Low | High | Decision B documents the partial reversal + rationale (D3, operator-approved); not silent. |

## Security Considerations
- Authorization hard gate. Coarse permission alone is insufficient — the per-target domain guard is the real control. Never expose a payroll write without the guard.
- Audit every profile/rate mutation (shared financial data).

## Next steps
- Rollback: revert permissions.ts + payroll-authz + panels + nav; snapshot restore. Decision B stays as historical record (mark superseded if reverted).
