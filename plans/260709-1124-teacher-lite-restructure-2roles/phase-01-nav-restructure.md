# Phase 1 — Nav restructure (teacher-only = schedule; hide 5 sections)

- **Date:** 2026-07-09 · **Priority:** P1 · **Status:** pending · **Risk:** Low · **Effort:** ~3h
- **Items:** #4 (teacher-only sees only Lịch dạy) + #5 (hide Học bạ/Duyệt cấp độ/Họp PH/Báo cáo điểm danh/Cockpit from teacher-lite nav)
- **Context:** brainstorm items 2, 6; plan.md governance (nav-hide ≠ Set-removal).

## Key insights (verified)

- Teacher nav is built in `apps/admin/src/shell.tsx` `buildNavGroups`-style flatMap at **L858-882**,
  gated by `surface !== 'teacher'` early-return at **L820**.
- `isTeacherOnly` already exists: **shell.tsx:680** = `roles.length === 1 && roles[0] === 'giao_vien'`.
- `teacherNavMergedIntoCalendar` Set (**shell.tsx:856**) currently hides `attendance`, `grading`,
  `classes` from teacher nav — this is the correct extension point for item #5 (add more keys), NOT
  the `TEACHER_SURFACE_SECTIONS` Set.
- `TEACHER_SURFACE_SECTIONS` (`app-surface.ts:11-33`) MUST keep: `attendance-report`, `assessment`
  (Học bạ), `meetings` (Họp PH), `levelup`, `edu-director-cockpit`, `biz-director-cockpit` — so
  directors keep direct-URL reach (df2a153 lesson, already documented at app-surface.ts:14-16).
- The per-item `visible` for the teacher flatMap is computed at **shell.tsx:868-878**; it already
  ANDs `TEACHER_SURFACE_SECTIONS.has(item.key)` and `!teacherNavMergedIntoCalendar.has(item.key)`.

## Requirements

**#4 teacher-only = schedule only.** When `isTeacherOnly`, the teacher-surface nav must render ONLY
`schedule` (Lịch dạy). All other sections hidden from nav (but director nav unchanged).

**#5 hide 5 sections from teacher-lite nav (all teacher-surface actors, incl. directors).** Hide from
nav: `assessment` (Học bạ), `levelup` (Duyệt cấp độ), `meetings` (Họp PH), `attendance-report`
(Báo cáo điểm danh), `edu-director-cockpit` + `biz-director-cockpit` (Cockpit). KEEP all in
`TEACHER_SURFACE_SECTIONS` for direct-URL.

## Related code (exact refs)

- `apps/admin/src/shell.tsx:680` — `isTeacherOnly`
- `apps/admin/src/shell.tsx:820` — `if (surface !== 'teacher') return groups;`
- `apps/admin/src/shell.tsx:856` — `teacherNavMergedIntoCalendar` Set (extend here for #5)
- `apps/admin/src/shell.tsx:858-882` — teacher flatMap + `visible` computation
- `apps/admin/src/app-surface.ts:11-33` — `TEACHER_SURFACE_SECTIONS` (DO NOT remove keys)

## Architecture / approach (KISS)

Two small edits, both inside the teacher flatMap (no new files, no Set-removal):

1. **#5**: add the 5 keys to `teacherNavMergedIntoCalendar` (rename intent stays — it is "hidden from
   teacher nav"). New Set members: `assessment`, `levelup`, `meetings`, `attendance-report`,
   `edu-director-cockpit`, `biz-director-cockpit`. Update the adjacent comment (shell.tsx:853-855) to
   say these are hidden-but-direct-URL-reachable, matching app-surface.ts:14-16.
   - NOTE: `edu-director-cockpit`/`biz-director-cockpit` currently have `visible: isEduDirectorOnly`/
     `isBizDirectorOnly` (shell.tsx:808-811). Adding them to the hidden Set removes them from the
     *teacher surface* nav only; ERP surface returns early at L820 and is unaffected. Verify the
     director's "Hôm nay/overview" still renders (overview stays visible — not in the hidden Set).

2. **#4**: gate the teacher flatMap so that when `isTeacherOnly`, only `schedule` survives. Simplest:
   in the `visible` expression (shell.tsx:868-878) add a leading `&& (!isTeacherOnly || item.key === 'schedule')`.
   Keeps director path identical; collapses giao_vien to a single item.

## Implementation steps

1. shell.tsx:856 — extend `teacherNavMergedIntoCalendar` with the 5 hidden keys (#5).
2. shell.tsx:868-878 — add `(!isTeacherOnly || item.key === 'schedule')` conjunct to `visible` (#4).
3. shell.tsx:853-855 — update comment to list newly-hidden sections + reason (direct-URL kept).
4. Confirm no key was removed from `TEACHER_SURFACE_SECTIONS` (app-surface.ts) — Set unchanged.

## No API symbols modified → GitNexus impact: N/A (pure client nav). Skip impact gate.

## Todo

- [ ] Extend hidden Set (#5)
- [ ] Add isTeacherOnly=schedule-only conjunct (#4)
- [ ] Update comment
- [ ] Manual verify: giao_vien nav = Lịch dạy only; director nav = Lớp học/Học sinh/Phụ huynh/Giáo viên (no Học bạ/levelup/meetings/report/cockpit); direct-URL `/assessment` still loads for director.

## Success criteria

- giao_vien-only: nav renders exactly one item (Lịch dạy).
- Director on teacher surface: 5 sections gone from nav; each still opens by direct URL.
- ERP surface (super_admin) nav unchanged (early-return L820 untouched).

## Risk / security

- Risk: over-hiding a section a director needs daily → mitigated: direct-URL kept + verify step.
- Risk: accidentally removing from `TEACHER_SURFACE_SECTIONS` would 404 direct-URL (df2a153 regression)
  → explicit "Set unchanged" check in steps.
- Security: no authz change; visibility is cosmetic. RLS + requirePermission still gate every route.

## Next steps

Feeds Phase 4 verification (director direct-URL reach; giao_vien single-nav).
