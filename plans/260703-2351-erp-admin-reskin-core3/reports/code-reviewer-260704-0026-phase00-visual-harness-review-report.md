# Code Review — Phase 0 Visual-Verification Harness

## Scope
- Files: `apps/e2e/tests/reskin-visual-capture.spec.ts` (new), `apps/e2e/package.json`, `apps/e2e/.gitignore`
- `git diff --stat HEAD`: confirms the diff touches ONLY these 3 files under `apps/e2e/` (plus pre-existing unrelated `AGENTS.md`/`CLAUDE.md` edits from before this session, not part of this task). No touches to `packages/ui`, `apps/admin/src/*.tsx`, or any router/production file.
- Focus: does it work, is it scoped correctly, is the documented STAFF_PASSWORD_LOGIN blocker real. Not over-scrutinizing style per instructions.

## Overall Assessment
Clean, correctly scoped, pure test tooling. No production code touched. Convention adherence to sibling spec is high. The one claimed environment blocker is verified as real and pre-existing, not a spec defect. No blocking issues found.

## Findings

### 1. Convention adherence — PASS
Compared directly against `apps/e2e/tests/admin-meeting-set-schedule.spec.ts`:
- `loginAdmin` helper: identical structure (goto → fill Email/Mật khẩu → click "Đăng nhập" exact → wait for nav visible), just parameterized for email/password instead of hardcoded — a legitimate, minimal generalization since this spec needs two different accounts (super_admin + cockpit-only). Not a divergent reinvention.
- Same `ADMIN_EMAIL`/`ADMIN_PASSWORD` env-var-with-default pattern.
- Same nav-click pattern: `page.locator('nav a').filter({ hasText: navLabel }).click()` — matches sibling spec's `page.locator('nav a').filter({ hasText: 'Họp PH' }).click()` exactly.
- `test.use({ baseURL })` per describe block — same pattern used repo-wide (confirmed in sibling spec, `test.use({ baseURL: 'http://localhost:5173' })`).

### 2. "networkidle resolves too early" fix — PASS, correctly reasoned, not a naked sleep
`captureNavSection` (lines 48-64): waits for a real assertion first — `header` text matching `headerTitle` exact, timeout 10s — THEN a fixed 300ms buffer, THEN `waitForLoadState('networkidle')`, THEN screenshot. This is not "papering over with a sleep": the primary correctness gate is the header-title assertion (a real DOM signal that the SPA section switched), and the 300ms is a bridging buffer before the second networkidle wait to avoid catching a loading-spinner frame between the title update and the panel's data-fetch effect starting. The comment (lines 55-59) accurately explains the root cause (networkidle races ahead because SPA nav is client-side, no real navigation) and the fix. This is a reasonable, non-fragile solution for non-gating screenshot capture. Not a blocker; a slightly tighter version could poll for the spinner's absence instead of a fixed 300ms, but that is a style optimization, not a defect, given this harness is explicitly not gating.

### 3. Scope — PASS
`git diff --stat HEAD` confirms only `apps/e2e/.gitignore` (+1 line), `apps/e2e/package.json` (+1 script), and the new spec file are part of this change. No production files touched.

### 4. `.gitignore` — PASS
`reskin-baseline/` added to `apps/e2e/.gitignore`. `playwright.config.ts` has `testDir: './tests'` and no `outputDir` override, so relative screenshot paths (`reskin-baseline/<name>.png`) resolve relative to `apps/e2e` (cwd when run via `pnpm --filter e2e reskin:capture`) — matches where the gitignore entry lives. Screenshots will not be committed.

### 5. STAFF_PASSWORD_LOGIN blocker claim — VERIFIED REAL, not a spec defect
Read `apps/api/src/routers/auth.ts:20-36`: the gate is
```
if (!result.session.isSuperAdmin && process.env.STAFF_PASSWORD_LOGIN !== 'true') {
  throw new TRPCError({ code: 'FORBIDDEN', ... });
}
```
i.e. any non-super_admin staff password-login requires the env flag, matching decision 0031 as cited. Verified the cockpit account itself is real and correctly targeted:
- `packages/db/src/seed.ts:115`: `{ email: 'quanly@cmc.local', ..., role: Role.giam_doc_kinh_doanh }` — seeded with the same `SEED_SUPERADMIN_PASSWORD` var (default `ChangeMe!123`), matching the spec's `COCKPIT_PASSWORD` default.
- `apps/admin/src/shell.tsx:418`: `isBizDirectorOnly = roles.length === 1 && roles[0] === 'giam_doc_kinh_doanh'` gates the "Cockpit điều hành" nav item — matches the spec's comment explaining why `quanly@cmc.local` (single-role GĐKD) is required instead of the super_admin account.
- `admin@cmc.local` (super_admin, seed.ts:297) is correctly used for the other 6 captures since super_admin always bypasses the gate (break-glass, per the code comment in auth.ts).

Conclusion: the blocker is a real, pre-existing environment-config gap (dev API not started with `STAFF_PASSWORD_LOGIN=true`), not a wrong seed email/password or a spec bug. The agent's claim checks out.

### 6. No business-logic assertions — PASS
All assertions in the spec are presentational: `toBeVisible()` on login form fields, nav-derived header titles, and a heading regex for the LMS login gate. No assertion checks data correctness, permissions enforcement, or business state — purely a visual-capture aid as the plan specifies (`Pixel-diff assertion is NOT required ... this is a visual aid, not a gating pixel test`).

## Minor / Informational (non-blocking)
- Plan phase-00 step 3 said "Copy/symlink the 15 wireframe PNGs into `apps/e2e/reskin-baseline/wireframes/`" as part of this phase's deliverable. The spec does not automate this — it documents the manual copy step in the header comment instead (source lives outside the repo at `D:\Downloads\stitch_cmcnew\...`, so full automation isn't portable anyway). Reasonable interpretation given the constraint, but worth the human confirming they've done the manual copy before relying on side-by-side comparison in later phases.
- `page.locator('nav a').filter({ hasText: navLabel })` uses substring matching, which could theoretically hit multiple nav items if labels overlap (e.g., a longer label containing a shorter one as a substring) and trip Playwright's strict-mode. This is an inherited pattern from the sibling spec, not a new risk introduced here — not a regression, just worth noting if nav labels change in later re-skin phases.

## Recommended Actions
None blocking. Optional: confirm the wireframe PNGs have actually been copied into `apps/e2e/reskin-baseline/wireframes/` locally before phase 1+ relies on the side-by-side comparison.

## Unresolved Questions
- None from a correctness/scope standpoint. Confirm with the plan owner whether the 6/7 captured screenshots have been reviewed against wireframes yet, or if that's deferred to phase 1 kickoff.
