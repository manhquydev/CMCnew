---
title: "Persona QA Fleet + UX Audit (6 roles, live prod)"
description: ""
status: pending
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-07-03T03:46:25.028Z"
createdBy: "ck:plan"
source: skill
---

# Persona QA Fleet + UX Audit (6 roles, live prod)

## Overview

6 blind-persona QA agents (sale, giáo viên, giám đốc kinh doanh, giám đốc đào tạo, học sinh,
phụ huynh) explore the live prod apps (erp.cmcvn.edu.vn admin, hoc.cmcvn.edu.vn LMS) as real
first-time users, doing role-realistic tasks, and reporting technical/UI/UX friction found along
the way. A `ui-ux-designer` synthesis pass turns the 6 reports into one prioritized findings
report. Single round (not a recurring mechanism yet — user decided to evaluate value first).

User explicitly authorized real prod testing (all current data is pre-launch/dev-stage) with
`[QA-TEST]` prefix convention for created data. Discovered constraint: staff login is SSO-only
(`STAFF_PASSWORD_LOGIN` fail-closed) — 4 staff-role personas need `STAFF_PASSWORD_LOGIN=true`
temporarily enabled for dedicated QA-TEST accounts (user-approved), reverted in Phase 4.

Source: `plans/reports/brainstorm-260703-0919-persona-qa-ux-audit-action-plan-report.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Setup Test Accounts](./phase-01-setup-test-accounts.md) | Pending |
| 2 | [Run Persona Agents](./phase-02-run-persona-agents.md) | Pending |
| 3 | [UX Audit Synthesis](./phase-03-ux-audit-synthesis.md) | Pending |
| 4 | [Cleanup](./phase-04-cleanup.md) | Pending |

## Dependencies

<!-- Cross-plan dependencies -->
