---
phase: 1
title: "Stitch Design Research"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Stitch Design Research

## Overview

Analyze design reference, audit current teacher screens, produce a component map and /stitch prompt set that guides phases 2–3.

## Requirements

- Functional: identify every screen to redesign + its tRPC endpoints
- Non-functional: design language must match reference (4-section sidebar, stat cards, master-detail)

## Architecture

No code changes in this phase. Output = design decisions + /stitch prompts.

Design reference location: `D:\Downloads\Thiết kế UIUX LMS và ERP\`
- `screenshots/approve-current.png` — Director dashboard (stat cards + todo)
- `screenshots/01-approve-screen.png` — Approval detail view
- `CMC EDU Prototype.dc.html` — Full HTML prototype

Current teacher surface entry: `apps/admin` at `?surface=teacher`  
Shell routing: `apps/admin/src/shell.tsx` (lines 678–866)

## Related Code Files

- Read: `apps/admin/src/shell.tsx` — nav structure for teacher surface
- Read: `apps/admin/src/teacher-lite-intake-panel.tsx` — director intake
- Read: `apps/admin/src/teacher-lite-class-control-panel.tsx` — class creation
- Read: `apps/admin/src/attendance-panel.tsx` — attendance marking
- Read: `apps/admin/src/session-evidence-panel.tsx` — photos + comments
- Read: `apps/admin/src/class-workspace.tsx` — class detail
- Read: `apps/admin/src/grading.tsx` — homework grading
- Read: `apps/admin/src/student-management-panel.tsx` — student list
- Read: `apps/admin/src/overview-panel.tsx` — current dashboard

## Implementation Steps

1. Open design reference screenshots in browser; take note of:
   - Color palette (sidebar dark, content white, accent blue)
   - Card layout pattern (4-stat top row, 2-col below)
   - Navigation items and grouping
   - Typography scale

2. Read each current teacher surface file (listed above). For each, record:
   - Component name
   - tRPC endpoints used
   - Current UX problems (dense forms, missing grouping, poor hierarchy)

3. Map old → new:
   | Old Component | New Component | Key Change |
   |---------------|---------------|------------|
   | `overview-panel.tsx` (teacher) | `TeacherTodayPanel` | Today's classes cards, not generic stats |
   | `class-workspace.tsx` | `SessionWorkspace` | 3-column: roster / attendance / evidence |
   | `grading.tsx` | `HomeworkFeed` | Feed of submissions, inline grading |
   | `teacher-lite-intake-panel.tsx` | `DirectorDashboard` | Stat cards + action list like design ref |
   | `teacher-lite-class-control-panel.tsx` | `QuickClassForm` | Single-page wizard, fewer fields |
   | `student-management-panel.tsx` | `StudentEnrollPanel` | Add student form with email send inline |

4. Write /stitch prompts (one per major screen — see Phase 2/3 for execution):
   - Teacher: "Build a Today's Classes card list for a teacher portal..."
   - Teacher: "Build a Session Workspace with 3 columns..."
   - Director: "Build a Director Dashboard with stat cards..."
   - Director: "Build a Quick Class Creation wizard..."

5. Confirm Mantine component versions in use (`package.json` of `apps/admin`)

## Success Criteria

- [ ] Component map table completed (old → new)
- [ ] tRPC endpoint list per new screen documented
- [ ] /stitch prompts drafted (≥4, one per major screen)
- [ ] Design token values noted (colors, spacing) from reference screenshots
- [ ] No code changes committed in this phase
