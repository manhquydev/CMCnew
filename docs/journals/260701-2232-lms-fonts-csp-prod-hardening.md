# LMS Fonts & CSP Prod Hardening

**Date**: 2026-07-01 22:31
**Severity**: Medium
**Component**: LMS (apps/lms), UI tokens, Docker build
**Status**: Resolved

## What Happened

The LMS was loading Fredoka and Quicksand typefaces from Google Fonts (`fonts.googleapis.com`) via a network request in the browser. Production CSP headers block cross-origin script/font loads, so the fonts never arrived on prod, leaving the LMS with a fallback system font stack and breaking the carefully designed "kid-friendly" claymorphic UI aesthetic from the redesign shipped on June 25.

**Root issue**: The LMS showcase route matcher was fragile (`exact /showcase` checks) and wouldn't work correctly when deployed under a Cloudflare origin with a base path or subdomain.

Commit: `5471869` (fix(lms): self-host kid fonts and harden showcase routing for prod CSP)

## The Brutal Truth

This is a one-line fix dressed up as a feature commit: add `@fontsource-variable` to `package.json`, import the fonts in `apps/lms/src/main.tsx`, and the kidfont stack works. But the **frustrating part** is that the claymorphic redesign (commit `c840851`, shipped June 25) was beautiful *on dev* but broke silently in prod because nobody tested under prod CSP during the redesign work. The UI redesign passed local e2e tests, but those tests don't run under CSP headers — they run on `localhost:3000` with no restrictions.

Even more annoying: the showcase route fix (`endsWith('/showcase')` instead of `exact '/showcase'`) was a throw-away fix for routing, but it's the kind of subtle bug that doesn't manifest until deployment to prod with a reversed proxy. This should have been caught in a pre-deployment checklist: "does every route matcher work under base-path rewrites?"

## Technical Details

**Font bundle change**:
- Removed: Google Fonts network request via `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" />`
- Added: `@fontsource-variable/fredoka` + `@fontsource-variable/quicksand` NPM packages (16 lines added to `pnpm-lock.yaml`)
- Import in `main.tsx`: 2 lines for CSS-in-JS font registration

**Showcase route hardening**:
- Before: `path="/showcase"` exact match (fails under base path)
- After: `endsWith('/showcase')` suffix match (works under `https://origin.edu.vn/lms/showcase`, `https://origin.edu.vn/showcase`, etc.)

**UI token polish**:
- Applied leftover claymorphic token polish from the June 25 redesign to `lms-login-gate.tsx` and `tokens.css` (7 lines changed in CSS file for token alignment)

**Docker**: Updated `apps/lms/Dockerfile` to include font assets in the build layer (minimal change, cache hit remains strong).

## What We Tried

1. **Audited CSP headers** in prod stack: confirmed `fonts.googleapis.com` is blocked by `default-src 'self'` + `font-src 'self'`.
2. **Evaluated font hosting options**:
   - Option A: Self-host fonts in S3/CDN under same origin — requires ops overhead.
   - Option B: Bundle fonts via `@fontsource` (npm package) — zero ops, fonts ship in the app bundle, guaranteed on-origin.
   - Chose Option B: simpler, instant availability, no cache-busting risk.
3. **Tested route matching logic** under various base-path scenarios locally (simulated with `BrowserRouter basename="..."` prop).

## Root Cause Analysis

**Font issue**: The claymorphic redesign was developed on `localhost:3000` where all requests are same-origin, so Google Fonts worked fine. CSP rules were never validated against the redesign during dev. This is a **test-environment gap** — should have run at least one test pass under a mock CSP-enforcing origin before merging the redesign.

**Showcase route issue**: Generic route-matching pattern (`exact` path) that doesn't account for deployment scenarios where the app lives at a subpath. This is a **assumptions gap** — the dev assumed the app would always be at the origin root, but prod reverses proxy and paths it under `/lms/`.

## Lessons Learned

1. **CSP testing must be part of pre-deployment validation.** Before prod rollout, spin up a local CSP-enforcing proxy (e.g., `http-server --csp` or similar) and run the e2e suite against it. This would have caught the font issue in 2 minutes.

2. **Route matchers should use suffix/prefix checks unless exact root match is critical.** `endsWith` is future-proof for base-path deployments; `exact` is fragile and requires assumptions about deployment topology that break during scale.

3. **Redesign work should include a CSP verification step.** When shipping UI redesigns with custom fonts/styles, verify they work under prod CSP constraints *before* merge, not after. Add this to the checklist for design work.

## Next Steps

- [x] Fonts bundled and imported in `main.tsx`.
- [x] Showcase route hardened with `endsWith()`.
- [x] `pnpm-lock.yaml` updated with `@fontsource-variable` entries.
- [x] Commit merged to `develop`.
- [ ] Deploy to prod and verify Fredoka/Quicksand render in LMS (spot-check parent/student login pages and homework list).
- [ ] (Optional) Add CSP header validation to CI/CD as a pre-merge check (can be low-priority post-incident).

---

**Session note**: This fix was discovered during the prep for the work-shift migration chain fix (commit `28a1c9c`). While reviewing prod deployability, noticed CSP blocking fonts. Bundled the fix and committed immediately before tackling the migration chain issue.
