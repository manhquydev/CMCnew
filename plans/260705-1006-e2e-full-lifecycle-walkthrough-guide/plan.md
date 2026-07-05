---
title: "E2E full-lifecycle walkthrough + role-based user guides"
description: "Run 9-stage live E2E on local stack, screenshot every step, produce Vietnamese role-based guides in docs/guides/ and a bug report"
status: done
priority: P1
effort: 10h
branch: develop
tags: [e2e, user-guide, walkthrough, local]
created: 2026-07-05
---

# E2E full-lifecycle walkthrough + role-based user guides

Live browser-driven (Chrome DevTools MCP) walkthrough of the full CMC business
lifecycle on the LOCAL stack. Every UI step is screenshotted; each stage becomes
a Vietnamese "vai trò nào — bấm gì — thấy gì" guide under `docs/guides/`. Bugs
found are fixed-if-blocking / logged-if-minor.

## Source design
- `plans/reports/brainstorm-260705-1006-e2e-full-lifecycle-walkthrough-guide-report.md` (9-stage backbone, decisions)
- `plans/reports/brainstorm-260705-0944-enrollment-session-provisioning-friction-report.md` (flow facts)

## Constraints (decided, do not re-litigate)
- Reset LOCAL DB clean + minimal seed (super_admin/directors + facility/curriculum catalog). Everything else created live via UI.
- Parent email: send REAL to manhquy.mqy@gmail.com; screenshot received email. Fallback = outbox verify if Brevo key missing (checked stage 0).
- Fix policy: flow-blocking bug → fix + commit develop; minor → log to `reports/bug-log.md` only.
- Scope OUT: the 4 process improvements from brainstorm-0944. No dev/prod server touches.
- Guides document CURRENT behavior (incl. manual "Sinh lịch" button).

## Phases
| # | Phase | Stages | Status |
|---|-------|--------|--------|
| 1 | [Environment reset & preflight](phase-01-environment-reset-and-preflight.md) | 0 | done |
| 2 | [Staff & class setup](phase-02-staff-and-class-setup.md) | 1-3 | done |
| 3 | [CRM → student provisioning](phase-03-crm-to-student-provisioning.md) | 4-6 | done |
| 4 | [Portal login & teaching day](phase-04-portal-login-and-teaching-day.md) | 7-8 | done |

## Dependencies
- P1 → P2 → P3 → P4 strictly sequential (each stage produces data the next consumes).
- P2 stage 1 hard-gated by P1 preflight `STAFF_PASSWORD_LOGIN=true` + `user.setPassword` per staff.
- P3 stage 5 requires P2 class + generated sessions; stage 6 email requires P1 Brevo/outbox decision.
- P4 stage 8 attendance requires P2 stage 3 sessions + P3 student/enrollment.

## Guide/screenshot output structure (consistent across phases)
```
docs/guides/e2e-walkthrough/
  README.md              # index: role → stages, login URLs, test creds
  00-reset-preflight/    guide.md + *.png
  01-hr-staff/           guide.md + *.png
  02-class-create/       guide.md + *.png
  03-generate-sessions/  guide.md + *.png
  04-crm-o1-o5/          guide.md + *.png
  05-receipt-approve/    guide.md + *.png
  06-parent-email/       guide.md + *.png
  07-portal-login/       guide.md + *.png
  08-teaching-day/       guide.md + *.png
```
Screenshot naming: `NN-<step>-<role>.png` (e.g. `03-sinh-lich-quanly.png`).

## Cross-phase rule
Blocking bug → fix, conventional-commit to develop, add row to `reports/bug-log.md`.
Minor/UX bug → row in `reports/bug-log.md` only (no code change).

## Acceptance criteria
- 9/9 stages complete, OR failing stage has a committed fix or a logged bug entry.
- `docs/guides/e2e-walkthrough/` has a guide per stage, each step tagged with role + screenshot.
- Parent-facing final proof: teacher evaluation + class photos visible in LMS portal (stage 8), screenshotted from parent view.
- `reports/bug-log.md` present (fixed + backlog sections), even if empty.
- No secrets/real PII in committed screenshots (test data only).
