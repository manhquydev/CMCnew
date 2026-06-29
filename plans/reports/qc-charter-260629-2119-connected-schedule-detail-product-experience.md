---
title: "QC Charter: Connected Schedule Detail — Product-Experience Testing"
date: 2026-06-29
target: http://localhost:5173  (dev — has the new code; prod does NOT)
feature: plans/260629-2102-connected-schedule-detail-navigation
mode: experience-observation (NOT code tests)
---

# QC Charter — Connected Schedule Detail

Three QC personas drive the REAL UI and observe experience, not code. Each reports
what a real user sees, where flow breaks, where labels/affordances confuse, and whether
the connected navigation actually feels connected.

## What changed (under test)

- `/#schedule` row click → new Session Detail (header + class card + roster + attendance + activity log).
- Class-card title / "Mở lớp học" → Class Workspace.
- Session Detail roster row → Student Detail; back returns to Session Detail.
- Class Workspace → Ghi danh tab: student row → Student Detail.

## Personas & charters

### QC1 — Teacher daily path (giáo viên)
- Login as a teacher-capable account.
- Open `/#schedule` → this week. Click a lesson row.
- Observe Session Detail: does it show date/time/status/room, the class, the enrolled students, attendance, and a log?
- Click a student → does Student Detail open? Back → returns to the same session?
- Click "Mở lớp học" → does the class open?
- Judge: ≤3 clicks from schedule to a student? Anything missing a real teacher needs?

### QC2 — Manager cross-entity path (quản lý / super_admin)
- Login as manager/super_admin.
- Schedule → session → class → student → back chain. Verify every link lands on the right record.
- Ghi danh tab: click a student row → Student Detail.
- Judge: do the modules feel connected now, or still siloed? Any dead-end where you must re-search?

### QC3 — Edge / UX skeptic (khó tính)
- Empty states: a class with no enrolled students; a date range with no sessions.
- Back/forward: leave schedule mid-detail, return — does it reset cleanly (no stale session shown)?
- Permission: a low-privilege role — are student/teacher links hidden or do they error?
- Vietnamese labels, status badges, alignment, loading states, broken affordances.
- Judge: where would a confused user get stuck?

## Observation checklist (all personas)

- [ ] Session Detail reachable from schedule row.
- [ ] Header fields correct (date/time/status/room).
- [ ] Class card link works.
- [ ] Roster shows enrolled students; row opens Student Detail; back works.
- [ ] Attendance section renders for the session.
- [ ] Activity log renders (class log), no error.
- [ ] EnrollTab student row opens Student Detail.
- [ ] No console errors; no 403/FORBIDDEN on a permitted role.
- [ ] Labels in Vietnamese, readable, aligned.
- [ ] Back navigation never strands the user.

## Output

Each persona returns: PASS/FAIL per checklist item + screenshot/observation notes + a
ranked list of experience issues (Blocker/Major/Minor) with what a user would feel.

## Open inputs (needed before run)

1. Working dev login (account + password, or SSO path) for `localhost:5173`.
2. Whether QC may perform writes (mark attendance) or must stay observation-only.
3. Browser driver + concurrency (sequential on one Chrome vs parallel Playwright contexts).
