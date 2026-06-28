# LMS "Leo Tầng Mây" — Plan

Status: IMPLEMENTED + VERIFIED (student climb shipped on develop) · Branch: develop · 2026-06-28

## User-approved directions (2026-06-28)
CMC-blue daytime sky · student role only · group nodes by program · replace the exercises
table entirely with the climb.

## Goal
Reskin the LMS student experience as a vertical cloud-climbing journey (metaphor from
`cungcontuhoc` cloud-garden/beanstalk), branded CMC, **no mascots**, over the existing
exercise/star/badge data. Visual + gamification layer only — no API/DB/auth change.

## Deliverables in this folder
- `design-spec.md` — concept, brand-fusion tokens, screen list, implementation surface, open Qs.
- `lms-cloud-climb-wireframe.html` — interactive 4-screen wireframe (open in a browser).
- `assets/` — CMC brand images the wireframe uses (logo, kid rounds, program marks).
- `preview-00..04-*.png` — rendered screenshots of each screen.

## Phases
1. **Wireframe + design** ✅ DONE — reviewed & approved.
2. **UI primitives** ✅ DONE — `apps/lms/src/climb/cloud-climb.tsx` (LMS-local, not @cmc/ui — YAGNI):
   `ClimbHud`, `ProgramBanner`, `CloudNode`, `CloudCelebration` + `cloud-climb.css`.
3. **Climb view** ✅ DONE — `apps/lms/src/climb-view.tsx` from `exercise.listForPrincipal` +
   `submission.mine` + `rewards.balance`; replaces the exercises tab (decision: full replace, no toggle).
   API: `exercise.listForPrincipal` enriched additively with `batch.course.program` for grouping.
4. **Brand assets** ✅ DONE — copied into `apps/lms/public/brand/`.
5. **Verify** ✅ DONE — typecheck/lint/build green; lms-full-lifecycle integration test green
   (exercises `listForPrincipal` end-to-end); code-review LOW risk, findings fixed.
   Remaining: live student-session screenshot on a deployed stack (needs a real student login).

## Acceptance
- Student sees a climbing path; nodes reflect real submission state (done/current/locked) + stars.
- Open node → existing exercise modal (PDF annotator / textarea / submit) works unchanged.
- Completion celebration on grade/pass. No mascots. CMC branding throughout.
- No changes to API routers, DB schema, auth, or env vars.

## Open questions (block phase 2) — see design-spec.md
1. Sky palette: CMC-blue daytime (this wireframe) vs purple→peach dusk (original)?
2. Climb for student only, or also a read-only parent view?
3. Group nodes by program vs single due-date-ordered climb?
4. Replace the exercises table, or keep a climb⇄list toggle?
