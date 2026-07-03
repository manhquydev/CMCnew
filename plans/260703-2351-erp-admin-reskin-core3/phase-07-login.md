# Phase 7 — Login

**Status**: verified, no code change needed (2026-07-04). Read `packages/ui/src/login-gate.tsx`
in full: inputs already 44px, all colors/text reference `var(--cmc-border)`/`var(--cmc-brand)`/
`var(--cmc-text)` tokens (no hardcoded literals to correct), no explicit `Button radius` override
(inherits Phase-1's new `xs` 4px default automatically). Live screenshot (logged-out state)
confirms Inter renders, button corners show the new 4px radius, border color reads correctly —
all inherited for free from Phase 1's token changes, nothing to restyle here. The decorative
`boxShadow` on the small CMC logo image (line ~113) was left untouched — it predates this plan,
is scoped to a single branding image (not a Card/Paper), and matches the login-exclusion the P1
shadow-remap plan already carved out; not reintroducing anything the Zero Elevation doctrine
removed elsewhere. `useSession`/SSO/error-handling logic never touched (zero diff to the file).

## Context
- Wireframe refs: `ng_nh_p_cmc_edu_1` / `_2` (#6/#7) — split hero (left brand image + slogan, right
  form). NOTE: these wireframes use Plus Jakarta Sans + kid orange accent + glass panels — that is
  the LMS/consumer login flavor, NOT the admin ERP portal.
- `login-gate.tsx` (verified) is already a bespoke split-hero: left gradient + `erp-login-bg.png` +
  "THINK / CREATE / LEAD.", right form with MS SSO. It is intentionally the ENTERPRISE variant, not
  the kid glass variant. P1 shadow plan already carved out a login-exclusion (a prior shadow edit
  there was flagged as a violation).
- Lowest-risk, done last. Scope here is minimal alignment, not a redesign.

## Requirements
- Inherit Inter (from Phase 1) — verify it applies to the login screen (LoginGate renders outside
  `.lms-app-root`, so it gets the admin Inter font). No per-screen font override needed.
- Verify corrected `--cmc-border` (#E5E7EB) and radius on inputs/buttons look right; inputs already
  44px height (matches Core 3 36-44px).
- Optional: tighten the right-column form card spacing to Core 3 rhythm. Do NOT adopt the kid glass/
  orange styling from #6/#7 — keep the enterprise hero.
- Keep MS SSO flow, error handling, and `useSession` logic 100% untouched.

## Files
- Modify: `packages/ui/src/login-gate.tsx`.

## Steps
1. `gitnexus_impact` on `LoginGate` (upstream: admin + any app using it).
2. Verify Inter renders; adjust only border/radius/spacing tokens if visibly off vs Core 3.
3. Confirm the `boxShadow` on the logo image / any element still respects the login-exclusion the
   P1 plan established (don't reintroduce decorative shadows the doctrine removed elsewhere).

## Tests / validation
- `pnpm -w typecheck`.
- Playwright: login screen (logged-out state) — Inter + corrected border/green.
- `gitnexus_detect_changes` — only `login-gate.tsx`; no auth logic change.

## Risks / rollback
- Risk: touching LoginGate breaks the SSO/session gate. Mitigation: styling-only; reviewer verifies
  the `me === undefined | null | Session` branching is byte-identical.
- Rollback: single-file revert.
