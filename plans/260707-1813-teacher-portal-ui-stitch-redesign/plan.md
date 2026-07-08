---
title: "Teacher Portal UI Redesign via Stitch"
description: "Redesign teacher + director UX inside apps/admin teacher surface using /stitch. Functional backend is complete (260707-teacher-lite-direct-lms-mvp). This plan is UI-only."
status: completed
priority: P1
branch: "develop"
tags: [ui-redesign, teacher, director, stitch]
blockedBy: []
blocks: []
created: "2026-07-07T11:22:51.384Z"
createdBy: "ck:plan"
source: skill
---

# Teacher Portal UI Redesign via Stitch

## Overview

Functional teacher + director system is fully built and local-verified in `260707-teacher-lite-direct-lms-mvp`. This plan redesigns only the UI layer inside `apps/admin` teacher surface (`?surface=teacher`).

Current pain: screens are generic ERP forms (Stack/Group/Select). Design reference (`D:\Downloads\Thiết kế UIUX LMS và ERP`) shows clean 4-section sidebar, stat cards, master-detail layout — much simpler and more task-focused.

No backend changes. No new routes. No auth changes. All tRPC endpoints remain as-is.

## Scope

**Teacher screens** (`giao_vien`):
- Today's classes dashboard → session workspace (attendance + photos + notes in 1 screen)
- Homework grading feed

**Director screens** (`giam_doc_dao_tao` / `giam_doc_kinh_doanh`):
- Dashboard with stat cards + action todo list
- Quick class creation (simplified form)
- Student management (add student + enroll + email parent)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Stitch Design Research](./phase-01-stitch-design-research.md) | Completed |
| 2 | [Teacher Screen Rebuild](./phase-02-teacher-screen-rebuild.md) | Completed |
| 3 | [Director Screen Rebuild](./phase-03-director-screen-rebuild.md) | Completed |
| 4 | [Integration and Smoke](./phase-04-integration-and-smoke.md) | Completed |

## Dependencies

- Functional foundation: `plans/260707-teacher-lite-direct-lms-mvp/plan.md` (status: local-verified)
- Design reference: `D:\Downloads\Thiết kế UIUX LMS và ERP\` (screenshots + HTML prototype)
- Brainstorm report: `plans/reports/brainstorm-260707-1813-teacher-portal-shell-redesign-report.md`

## Acceptance Criteria

- [ ] Teacher logs in → sees today's class list immediately, no extra nav
- [ ] Attendance for whole class ≤ 3 interactions
- [ ] Upload photo + write comment in same screen as attendance
- [ ] Director dashboard shows live stat cards (classes, sessions today, pending actions)
- [ ] Director creates class in ≤ 60s
- [ ] Director adds student + triggers parent email in 1 form
- [ ] UI matches design reference visual style (sidebar, cards, clean layout)
- [ ] All existing nav tests still pass (`nav-teacher-consolidation.test.ts`)
