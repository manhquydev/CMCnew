# Phase U1 — Staff Profile (Read-Only Detail Page)

## Context Links

- Plan: `plan.md`
- Pattern to mirror: `apps/admin/src/student-detail.tsx` (multi-tab + Chatter, opened via parent with `{id, onBack}`)
- Existing surfaces: `apps/admin/src/App.tsx` `HrPayrollSection()` (~L545), `OrgPanel()` (~L523-541), `payroll-panel.tsx` `StaffDetailDrawer` (~L428)
- Read endpoints (all gated `['hr','ke_toan']`): `payroll.roster`, `payroll.profileList`, `payroll.rateList`, `payroll.payslipList`, `payroll.kpiList`, `payroll.listByStaff`; identity from `user.list`.

## Overview

Build a read-only Staff Profile detail page: a staff roster → click → detail with permission-gated tabs. No new write power. No combined salary payload.

## Requirements

- List view of staff (reuse `payroll.roster` / `user.list`), with search + facility scope (RLS already applies).
- Detail page with tabs, each lazy-loading from its OWN already-gated endpoint:
  - **Hồ sơ** — identity (displayName, email read-only, primaryRole, isActive) + employment (position, grade, dependents, Callio ext, startedAt) via `user.list`/`payroll.profileList`.
  - **Phân quyền** — roles, facilities, active (READ-only here; edit stays in existing super-admin flow / U2 wiring).
  - **Lương & phụ cấp** — `payroll.rateList` + `payroll.payslipList`/`listByStaff`. Tab RENDERED ONLY if caller passes the payroll permission; otherwise tab hidden.
  - **KPI** — `payroll.kpiList`/`kpiEvalGet`, gated as today.
  - **Nhật ký** — placeholder until U3 (do NOT wire open Chatter for `user`).
- Tab visibility driven by the existing `can()` / permission registry, mirroring `shell.tsx` `NAV_GATES` usage. A hidden tab must not fire its query (no over-fetch, no leak).

## Files To Modify/Create (proposed)

- Create `apps/admin/src/staff-profile.tsx` — `StaffProfilePanel({ userId, onBack })`, mirroring `student-detail.tsx`.
- Modify `apps/admin/src/App.tsx` — `HrPayrollSection()` to host roster→StaffProfile navigation (keep `PayrollPanel` reachable or fold its staff drawer in later).
- No schema changes. No new write procedures.
- Optional (only if profiling shows N+1 chattiness): a thin read-only `payroll.profileGet(userId)` returning identity+employment ONLY (never salary), gated to roster viewers. Default: skip; compose existing endpoints.

## Permission Mapping (confirm before build)

| Tab | Source | Who sees it |
|---|---|---|
| Hồ sơ | user.list + payroll.profileList | hr, ke_toan (+ super_admin) |
| Phân quyền | user.list | super_admin (read for hr/ke_toan optional) |
| Lương & phụ cấp | payroll.rateList/payslipList | hr, ke_toan ONLY |
| KPI | payroll.kpiList | hr, ke_toan, directors (as today) |
| Nhật ký | (U3) | (U3 gated) |

## Validation

- Unit/component: tab gating — a role without payroll permission never renders or queries salary tab.
- Integration: each tab query returns expected shape; RLS keeps cross-facility staff invisible.
- Manual: profile loads for a sample staff; salary tab absent for a non-HR test session.
- Regression: existing PayrollPanel/KPI flows unaffected.

## Risks and Rollback

Risk: accidentally fetching salary for unauthorized viewer.
Mitigation: per-tab lazy query + gate check before query; no combined endpoint.
Rollback: feature-flag the new section or keep old `hr`/`org` panels until parity confirmed.
