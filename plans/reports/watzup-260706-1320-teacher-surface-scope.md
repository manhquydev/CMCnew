---
type: watzup
date: 2026-07-06
story: TEACHER-CMCVN-LMS-BRIDGE
---

# Teacher Surface Handoff

## Current State

Branch: `develop`. Worktree is dirty with the broader teacher/LMS story changes plus unrelated pre-existing repo changes. No commit made.

`watzup-scan` was attempted but timed out after 120s, so this handoff uses fallback read-only checks: `git status`, `git worktree list`, plan/doc scans, recent verifier output.

## Recent Work

- Corrected `teacher.cmcvn.edu.vn` away from ERP/full finance surface.
- Added focused `family-intake` teacher route and role-specific nav guard.
- Changed teacher intake UI to PH+HS wording and hidden finance controls.
- Deployed updated admin container to VPS.
- Updated story validation docs and synced them to `/root/cmcnew`.

## Verification

- `pnpm --filter @cmc/admin typecheck` pass.
- Teacher/director focused admin tests pass: 21 tests.
- `pnpm --filter @cmc/admin build` pass.
- `scripts/verify-teacher-cmcvn-lms-bridge.ps1` pass: API/UI typecheck, DB generate/migrate/seed, 13 Playwright tests.
- `scripts/verify-teacher-cmcvn-live-smoke.ps1` pass on production: teacher title `CMC Teacher Portal`, asset `/assets/index-fou0Ms-B.js`, `family-intake` marker.
- GitNexus `detect_changes` risk remains medium because the whole story touches many files; no HIGH/CRITICAL surfaced in this pass.

## Next Steps

1. Run operator-assisted production SSO with a real teacher/director account.
   Rationale: only remaining gap is post-MFA production role surface, not local role logic.
2. Review dirty worktree before commit.
   Rationale: many files are modified/untracked from the broader story; keep commit focused.
3. Open PR from `develop` only after final human SSO evidence or explicit acceptance of the gap.
   Rationale: branch rule forbids direct main changes.

## Warnings

- The full `watzup-scan` did not complete; this report is fallback-based.
- GitHub Actions billing is blocked per README; Jenkins is the real CI path.

## Unresolved Questions

- Who will supply or operate the real Microsoft staff account for production post-login proof?
