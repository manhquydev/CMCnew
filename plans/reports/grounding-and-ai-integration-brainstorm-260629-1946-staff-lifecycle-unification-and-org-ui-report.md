---
title: "Brainstorm: Integration-First Staff Lifecycle + HR/User Unification + Org UI Gaps"
date: 2026-06-29
lane: high-risk
status: completed
scope: research-brainstorm-no-implementation
intake: 26
related:
  - ../260629-1409-microsoft-graph-identity-provisioning-hard-plan/plan.md
  - ../../docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md
  - security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md
---

# Brainstorm: Integration-First Staff Lifecycle + HR/User Unification + Org UI Gaps

## Summary

Three questions, all answered with code evidence (no assumptions):

1. **Integration vs manual M365:** Most of the staff lifecycle CAN be integrated via Microsoft Graph. Only a small set genuinely must stay manual in M365. Decision still gated by ADR 0015 (tenant-write approval).
2. **Merge HR/payroll with user-management?** The data is ALREADY unified on `AppUser.id`. The split is UI-only. Your instinct is correct: unify the surface, separate by permission. No data restructuring needed.
3. **"Cơ sở & người dùng" UI:** Confirmed sparse. User edit = a small modal (roles/facilities/active only). Facility edit = backend exists but NO UI. Audit IS written but NOT shown — and for `user`/`facility` that hiding is an intentional security gate, not a bug.

Recommended path is integration-first where safe, a unified "Staff Profile" detail surface, and a secure (facility-scoped) staff activity log — sequenced behind the existing ADR gates.

## Evidence Base

All claims below are verified against current code on branch `develop`.

### Finding 1 — HR/payroll and user-management share one identity

| Data | Model | Join key | Status |
|---|---|---|---|
| Identity (email, displayName, roles, primaryRole, isActive, facilities) | `AppUser` | `AppUser.id` | base |
| Employment (position, grade, dependents, callioExt, startedAt) | `EmploymentProfile` | `userId` unique 1:1 | `schema.prisma:1243-1259` |
| Payslip | `Payslip` | `userId` + periodKey | verified |
| Salary rate | `SalaryRate` | `userId` | verified |
| KPI score | `KpiScore` | `userId` + periodKey | verified |
| Call metric | `CallMetric` | `userId` + periodKey | verified |
| Compensation policy | `CompensationPolicy` | company-wide, no user link | verified |

Conclusion: a unified "Staff Profile" needs only LEFT JOINs on `AppUser.id`. There is no separate employee entity to reconcile. `EmploymentProfile` intentionally omits a Prisma relation to keep `AppUser` lean (`schema.prisma:1242`) — a view can still join on `userId`.

Today the UI splits this into separate sections (`apps/admin/src/shell.tsx`): `hr` ("Nhân sự & Lương" → PayrollPanel), `kpi`, `compensation`, and `org` ("Cơ sở & Users"). Separation is nav + permission gates only (`packages/auth/src/permissions.ts`).

### Finding 2 — Org/user UI is thin

- `OrgPanel` is inline in `apps/admin/src/App.tsx:523-541` (no dedicated panel file).
- Facilities: read-only table; create modal only; **no edit UI** even though `facility.update` exists (`apps/api/src/routers/facility.ts:19`).
- Users: list + a `UserEditModal` (App.tsx:369-461) that edits ONLY roles, primaryRole, facilities, isActive — backed by `user.setRoles` / `user.setFacilities` / `user.setActive` (all `superAdminProcedure`).
- NOT editable anywhere: `email`, `phone`, `displayName` — no update endpoint exists in `user.ts`.
- The richer pattern already exists elsewhere: `student-detail.tsx` (multi-tab + Chatter timeline) and `payroll-panel.tsx` `StaffDetailDrawer`. Org just doesn't use it.

### Finding 3 — Audit is written but intentionally not shown for user/facility

- All user/facility changes ARE logged via `logEvent` (`user.ts:144/189/222/252`, `facility.ts:33/56`).
- `Chatter` UI (`packages/ui/src/chatter.tsx`) is wired for student, class_batch, opportunity, after_sale_case, receipt.
- `audit.ts` `NOTE_TARGETS` whitelist (lines 12-23) deliberately EXCLUDES `user` and `facility`. The comment (`audit.ts:32-37`) states the reason: `record_event` rows with `facility_id IS NULL` (user/course events) are readable by any staff under RLS, so exposing a `user` timeline would let any staff read anyone's role/facility/activation history. **This is a security decision, not an oversight.**

Implication: a staff activity-log UI is desirable, but it must NOT reuse the open Chatter path. It needs a facility-scoped, permission-gated timeline (super_admin / HR / the relevant director only).

## Brainstorm — Option Analysis

### A. Unify HR + Payroll + User into a "Staff" workspace

| Option | What | Pros | Cons | Verdict |
|---|---|---|---|---|
| A1 Keep separate (status quo) | 4 nav sections | no work | the exact fragmentation you felt | reject |
| A2 Unified "Staff" section, permission-gated tabs | One "Nhân sự" surface; list → Staff Profile detail with tabs: Hồ sơ, Phân quyền, Lương & phụ cấp, KPI, Nhật ký | matches data reality (all `AppUser.id`); fewer clicks; clear "who edits what" via existing permission registry | needs detail page + tab gating | **recommend** |
| A3 Merge into one giant editable form | everything on one screen | — | violates separation-of-duties; HR editing roles, IT seeing salary | reject |

A2 is the KISS unification: one read surface, tabs hidden/read-only by permission. Editing stays where it belongs:
- Identity/roles/facilities/active → super_admin (today's contract).
- Employment (position, grade, hire date, Callio ext) → HR/ke_toan (today's payroll permission set).
- Salary/KPI → existing payroll/KPI gates.
- Activity log tab → read-only, facility-scoped.

### B. What to integrate via Graph vs leave manual in M365

Gated by ADR 0015. Mapping the wish "integrate everything possible, manual only when impossible":

| Lifecycle step | Integrate via Graph? | Evidence / caveat |
|---|---|---|
| Read license inventory | YES | `GET /subscribedSkus`, read-only — ADR axis A1 |
| Create staff Microsoft user | YES | `POST /users` — ADR axis A2 |
| Assign license | YES | `assignLicense` — ADR axis A2 |
| Deliver first credential | PARTIAL | TAP (preferred) needs API+policy verification; else temp-password no-store; else manual — ADR axis B |
| Disable on offboard | YES | `PATCH accountEnabled=false` — may need Entra role; ADR axis A3 |
| Revoke sessions | YES | `revokeSignInSessions` — ADR axis A3 |
| Remove license | YES | `assignLicense` removeLicenses — ADR axis A3 |
| Mailbox retention / legal hold | MANUAL | not an identity API; IT/compliance owns |
| OneDrive/SharePoint ownership transfer | MANUAL | separate M365 admin task |
| Teams/group cleanup | MANUAL (MVP) | possible later via Graph groups; out of scope now |
| Device/Intune | MANUAL | separate product surface |
| Permanent delete | MANUAL (MVP) | `DELETE /users` risky; ADR axis C2 only with retention policy |

So "integrate the lifecycle, leave only the genuinely non-identity tasks to M365" is achievable — but it is exactly what ADR 0015 already sequences. This brainstorm does not change that gate; it confirms the integration surface should live inside the unified Staff Profile (a "Microsoft account" tab showing entraUserId, license, account status, with provision/deprovision actions gated to super_admin/IT).

### C. Org UI gaps to close (independent of Graph)

These are safe, integration-independent improvements:

1. Staff Profile detail page (A2) reusing the `student-detail.tsx` tab pattern.
2. Facility detail + edit UI wiring the existing `facility.update` endpoint.
3. Add `user.updateProfile` endpoint for displayName/phone (email stays SSO-derived, likely read-only).
4. Secure staff activity-log tab — NEW facility-scoped timeline endpoint, NOT the open Chatter whitelist.

## Recommended Sequencing (proposal, needs approval)

Phase ordering chosen so value lands early and Graph risk stays gated:

1. **U1 — Unified Staff Profile (read-first).** Detail page joining AppUser + EmploymentProfile + latest payslip/KPI, tabs gated by permission. No new write power. Low risk.
2. **U2 — Org editing parity.** Facility edit UI + `user.updateProfile` (displayName/phone). Medium risk (new write endpoint; audit required).
3. **U3 — Secure staff activity log.** Facility-scoped, permission-gated timeline tab. Medium risk (must not reuse open Chatter).
4. **G1 — Graph read-only diagnostic.** ADR 0015 axis A1. Surfaces license inventory in the Microsoft tab.
5. **G2 — Onboarding integration.** ADR axis A2 + chosen B credential path.
6. **G3 — Deprovision integration.** ADR axis A3 + C1 scope.

U1–U3 do not need the Graph ADR; they can proceed first. G1–G3 stay behind ADR 0015 approval.

## Honest Caveats (anti-hallucination)

- "Unification is HIGH feasibility" is about DATA (all on `AppUser.id`). UI/permission work is still real effort; not free.
- I did NOT verify every payroll permission line; the separation-of-duties claim rests on `permissions.ts` gates that exist but were not exhaustively enumerated here.
- TAP integration is still UNVERIFIED at the Graph API/permission level (carried from ADR 0015 / critique). Do not assume it works until checked.
- No design doc defines the intended user/facility detail page — so "matches design" cannot be claimed; the `student-detail.tsx` pattern is the de-facto model, not a written spec.
- This report changes no code and does not move the ADR gate.

## Unresolved Questions

1. Approve the unified "Staff Profile" surface (A2) as the target, replacing the 4 separate sections with permission-gated tabs?
2. Should `email` stay read-only (SSO-derived) while `displayName`/`phone` become editable via a new `user.updateProfile`?
3. Confirm the staff activity-log tab must be a new facility-scoped endpoint (NOT the open Chatter path) — agree?
4. Start with U1–U3 (no Graph) now, and keep G1–G3 behind ADR 0015 approval? Or wait and do everything together?
5. For ADR 0015 axes: which A/B/C options do you want to commit to so G-phases can be scoped?
