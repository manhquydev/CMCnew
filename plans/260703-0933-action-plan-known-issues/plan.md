---
title: "Action Plan: Fix Known UX/Debt Issues (checkin IP leak, DEBT.md UI gaps, CI check)"
description: ""
status: pending
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-07-03T02:34:07.059Z"
createdBy: "ck:plan"
source: skill
---

# Action Plan: Fix Known UX/Debt Issues (checkin IP leak, DEBT.md UI gaps, CI check)

## Overview

Fixes for concrete UX/technical debt found during a live investigation session (2026-07-03):
checkin-panel leaks a raw IP address to non-technical staff, 3 backend endpoints have no admin
UI caller (per `DEBT.md`), and the Jenkins `CMCnew CI` GitHub check still doesn't post reliably
despite a prior partial fix. Small, independent, low-risk items — no phase blocks another.

Two items surfaced by this investigation are explicitly NOT code tasks and are tracked here only
as operator action items, not phases: (a) `/shift-config` still holds seed-placeholder shift
times, needs the operator to enter the real company shift schedule; (b) all 4 active prod staff
accounts have zero `EmploymentProfile` rows, needs HR to onboard each via the "Nhân sự & Lương"
tab. Neither has a code fix — the app already supports both via existing admin UI.

Source: `plans/reports/brainstorm-260703-0919-persona-qa-ux-audit-action-plan-report.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [IP Display Fix](./phase-01-ip-display-fix.md) | Pending |
| 2 | [Missing UI Screens](./phase-02-missing-ui-screens.md) | Pending |
| 3 | [CI Check Investigation](./phase-03-ci-check-investigation.md) | Pending |

## Operator action items (not code — no phase covers these)

- [ ] Enter real company shift schedule at `/shift-config` (currently seed placeholder data: `KINH_DOANH`/`GIAO_VIEN`, Ca1/2/3 default hours).
- [ ] Onboard all 4 active staff via the "Nhân sự & Lương" tab → `EmploymentProfile` (currently 0/4 have one — blocks payroll and, until Phase 1 lands, gives a raw crash on check-in/shift-registration for any account without one).

## Dependencies

<!-- Cross-plan dependencies -->
