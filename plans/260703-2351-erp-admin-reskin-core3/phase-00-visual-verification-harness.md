# Phase 0 — Visual-verification harness

## Context
- This is presentation work: `typecheck` passing does not prove the visual result matches
  the wireframe. Every later phase needs a repeatable "live screen vs wireframe png" check.
- `apps/e2e/package.json` already depends on Playwright (grep-confirmed). Reuse it; do not
  add a second test runner.
- Wireframe reference PNGs live at `D:\Downloads\stitch_cmcnew\stitch_cmcnew\<folder>\screen.png`.

## Requirements
- A Playwright spec that logs into the admin app (seed account, e.g. `it@cmc.local`) and
  captures full-page screenshots of the named screens per phase into a stable output dir.
- A side-by-side comparison artifact (screenshot + matching wireframe png) a human /
  code-reviewer can eyeball. Pixel-diff assertion is NOT required (layouts differ in data);
  this is a visual aid, not a gating pixel test.

## Files
- Create: `apps/e2e/tests/reskin-visual-capture.spec.ts` (or repo's existing e2e naming).
- Create: `apps/e2e/reskin-baseline/` output dir (gitignored) for captured PNGs.
- Copy/symlink the 15 wireframe PNGs into `apps/e2e/reskin-baseline/wireframes/` for
  offline side-by-side (source folder is outside the repo).

## Steps
1. Read existing `apps/e2e` config + any auth/login helper already present; reuse the
   login flow rather than reinventing it.
2. Add a parametrized spec: array of `{ section, route/navLabel, wireframe }`; for each,
   navigate, wait for network idle, `page.screenshot({ fullPage: true })`.
3. Add an npm script (e.g. `pnpm --filter e2e reskin:capture`) that runs it against a
   locally running admin dev server.
4. Document in the spec header how to view results next to wireframes.

## Tests / validation
- Run once against the CURRENT (pre-reskin) UI to produce the "before" set — this doubles
  as the regression baseline (esp. one LMS screen for P1's LMS-untouched guard).

## Risks / rollback
- Risk: seed account / dev-server assumptions drift. Mitigation: reuse existing e2e login
  helper; if none, gate this phase on confirming the seed login works.
- Rollback: harness is additive test tooling — delete the spec; zero production impact.
