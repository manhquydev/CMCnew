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

## Login & branding pass (2026-06-28) — DONE + live-verified
- **Auth design is correct as-is** (verified against `apps/api/src/routers/lms-auth.ts`): **Phụ huynh = Email OTP**
  (`otpRequest`/`otpVerify`), **Học sinh = mã đăng nhập + mật khẩu** (`loginStudent`). Both already
  implemented in `lms-login-gate.tsx`. No mismatch — the student code+password is intentional, not a bug.
- Redesigned the bare login into a branded page: CMC sky gradient, logo, tagline, PH/HS helper copy, and a
  real-info footer (`packages/ui/src/lms-brand.tsx` `CMC_BRAND` + `LmsFooter`) sourced from the public site
  `D:\project\CMC\src\website` (hotline 0856 636 398, contact@cmcvn.edu.vn, address, FB/Zalo, cmcvn.edu.vn).
- Favicon + apple-touch-icon + theme-color + description + title in `apps/lms/index.html` (CMC icon assets).
- Climb program zones now use the official program accent colors (UCREA #FF7B2E, BRIGHT I.G #1B98E0,
  BlackHole #7950F2).
- **Live render proof**: provisioned a dev student (`HS-DEMO-LEOMAY`) with 7 exercises across 3 programs,
  started the LMS dev server, logged in, and captured real screenshots: `render-01..05-*.png`.

## UI revamp pass (2026-06-28) — DONE + live-verified
- **Nav overlap bug FIXED** (`student-shell.tsx` + `parent-shell.tsx`): the inline
  `<AppShell.Main style={{padding}}>` override dropped Mantine's navbar/header offset → fixed
  240px navbar overlapped content. Fix: `padding={32}` on `<AppShell>`, remove Main override;
  climb bleed now `calc(var(--app-shell-padding) * -1)`. Aligns with admin shell's `padding={0}`
  pattern (system-sync). Verified live: climb starts at x=240 (navbar edge), no overlap.
- **"Lung linh" garden re-skin** (mascot-free): ported cloud-garden assets from cungcontuhoc
  into `apps/lms/public/garden/` (flower/cloud nodes, ambient cloud/leaf/butterfly, ground strip,
  cloud-burst/star-pop VFX). The pre-rendered scene backgrounds embed the Kisu fox → excluded;
  garden look composed from clean elements + gradient sky.
- **Login** now layers a CMC website classroom photo behind the gradient; footer gained a
  3-program color-dot row.
- Code review: LOW risk, ship-ready. Follow-up: compress cloud-platform.png (2.2MB) + leaf.png (1.7MB).

## Open questions (block phase 2) — see design-spec.md
1. Sky palette: CMC-blue daytime (this wireframe) vs purple→peach dusk (original)?
2. Climb for student only, or also a read-only parent view?
3. Group nodes by program vs single due-date-ordered climb?
4. Replace the exercises table, or keep a climb⇄list toggle?
