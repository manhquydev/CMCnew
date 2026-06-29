---
title: "Plan: Unified Staff Profile (U1–U3)"
date: 2026-06-29
status: proposed
lane: high-risk
scope: plan-only-stop-at-plan
intake: 26
inputs:
  - ../reports/grounding-and-ai-integration-brainstorm-260629-1946-staff-lifecycle-unification-and-org-ui-report.md
  - ../../docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md
validated_by: two independent read-only Explore agents (data+permissions, UI+audit) — all claims CONFIRMED, no security gaps
---

# Plan: Unified Staff Profile (U1–U3)

## Overview

Replace the fragmented staff experience (separate `hr`, `kpi`, `compensation`, `org`/Users surfaces) with ONE permission-gated **Staff Profile** detail page, reusing the existing `student-detail.tsx` multi-tab + Chatter pattern. Data is already unified on `AppUser.id`; this is a UI + thin-API consolidation, not a data restructure.

Microsoft Graph provisioning (G-phases) is OUT of scope here and stays behind ADR 0015.

## Validated Facts (locked, evidence-backed)

- Staff identity == `AppUser`; `EmploymentProfile` is 1:1 via `userId` (`schema.prisma:1243-1259`).
- Payroll/KPI/rate/call-metric all join `userId` and carry `facilityId` for RLS.
- Read endpoints already exist, gated `['hr','ke_toan']`: `payroll.roster`, `payroll.profileList`, `payroll.rateList`, `payroll.payslipList`, `payroll.kpiList`, `payroll.listByStaff`.
- Directors CANNOT read payslips (gate excludes them) — salary protection is real, must be preserved.
- `user.setRoles/setActive/setFacilities` are `superAdminProcedure`; `user.create` adds directors. No `email/displayName/phone` update endpoint exists.
- `facility.update` exists (`facility.ts:19`) but has NO UI.
- `RecordEvent` has `facilityId` + `entityType`/`entityId`; `getTimeline` filters by entity but NOT by facility.
- `audit.ts` `NOTE_TARGETS` deliberately excludes `user`/`facility` (RLS security: `record_event.facility_id IS NULL` rows readable by any staff). Open Chatter MUST NOT be widened.
- Reuse candidates: `student-detail.tsx` (tab+Chatter pattern), `payroll-panel.tsx` `StaffDetailDrawer` (payroll tab body).

## Core Design Decisions (standardized)

1. **One Staff Profile, permission-gated tabs** — not one merged form (preserves separation of duties).
2. **Lazy per-tab loading via existing gated endpoints** — NO single combined payload that returns salary, so non-HR roles never receive salary data over the wire. Each tab calls its own already-gated query.
3. **Edit-where-it-belongs** — identity/roles → super_admin; employment (position/grade/hire/Callio) → hr/ke_toan; salary/KPI → existing payroll gates; profile contact (displayName/phone) → new narrow endpoint.
4. **`email` stays read-only** (SSO-derived).
5. **Secure activity log is a NEW facility-scoped, permission-gated endpoint** — never the open Chatter `NOTE_TARGETS` path.
6. **Every new mutation audits via `logEvent`** (matches existing pattern).

## Phases

| Phase | File | Risk | Purpose |
|---|---|---|---|
| U1 | `phase-u1-staff-profile-read.md` | normal | DONE — read-only Staff Profile in `org` section: Hồ sơ/Phân quyền/Lương(gated)/Nhật ký(U3 placeholder). KPI tab deferred (needs period arg). Admin typecheck clean; code review PASS (no leak). KPI tab not yet built. |
| U2 | `phase-u2-org-edit-parity.md` | high-risk (write + authz + audit) | DONE (uncommitted, awaiting approval) — `user.updateProfile` (displayName/phone only, email locked, audited, no tokenVersion bump, super_admin-only); `FacilityEditModal` wires `facility.update`; contact edit in UserEditModal; phone/address added to selects. API+admin typecheck clean; permission-parity 25/25; code review no blocking issues. |
| U3 | `phase-u3-secure-activity-log.md` | high-risk (authz + audit visibility) | New facility-scoped, gated staff/facility timeline endpoint + UI tab. |

## Dependencies

- U2 and U3 depend on U1's detail-page shell existing.
- U3 depends on a new audit query path; must not reuse open Chatter.
- No dependency on ADR 0015 / Graph.

## Success Criteria

- One Staff Profile page replaces the scattered staff views, with tabs visible per permission.
- No salary/KPI data reaches a role not already permitted by `permissions.ts`.
- Facility edit works through the existing `facility.update`.
- `displayName`/`phone` editable; `email` read-only; all changes audited.
- Staff activity log is visible only to permitted, facility-scoped viewers; open Chatter whitelist unchanged.
- All existing payroll/user/KPI tests still pass; new behavior covered.

## Out of Scope

- Microsoft Graph create/license/deprovision (ADR 0015 G-phases).
- Self-service "my profile" for staff (noted by validation; separate story).
- Merging compensation-policy config into the per-staff page (stays company-wide).
- Hard-deleting users/facilities.

## Stop Conditions

- Pause if a unified read would require returning salary to a non-HR role.
- Pause if widening Chatter `NOTE_TARGETS` is proposed (use the new gated path instead).
- Pause if a tab needs a permission not already in `permissions.ts` (needs a decision).

## Open Questions (for approval before implementation)

1. Confirm tabs + per-tab permission mapping in U1 (see phase file) is correct.
2. `user.updateProfile`: who may edit another user's displayName/phone — super_admin only, or also directors within facility?
3. Staff activity-log viewers: super_admin + hr + the relevant facility director only? Or also quan_ly?
4. Keep the old `org` Users/Facilities section as a thin redirect into the new Staff Profile, or remove it?
