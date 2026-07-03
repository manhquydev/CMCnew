# P1 Shadow Token Remap — Code Review

## Scope
Files reviewed: `packages/ui/src/theme.ts`, `packages/ui/src/tokens.css`, `packages/ui/src/theme.test.ts` (new), `apps/admin/src/design-showcase.tsx`, `packages/ui/src/lms-login-gate.tsx`, `docs/design-system.md`. Cross-checked exclusions: `packages/ui/src/leaderboard.tsx`, `apps/lms/src/showcase-view.tsx`, `apps/lms/src/student-shell.tsx`, `packages/ui/src/login-gate.tsx`, `packages/ui/src/pdf-annotator.tsx`, `packages/ui/src/notification-center.tsx`, `packages/ui/src/components.tsx`.

## Findings

### 1. BLOCKING — `packages/ui/src/lms-login-gate.tsx` violates the login-exclusion constraint
`LmsLoginGate` is literally the LMS parent/student sign-in screen (own doc comment: "Login gate for the LMS (parents + students)"). The diff removes `shadow="md"` from the form-container `Paper`:
```diff
 <Paper
   withBorder
-  shadow="md"
   p="xl"
```
Since `Paper`'s theme default just changed from `shadow: 'xs'` to `shadow: 'none'` in this same PR, removing the explicit override is not a no-op — it changes the rendered visual (login card shadow disappears). The user's explicit instruction earlier this session was that login-screen UI is out of scope for the whole ERP UI rebuild ("không yêu cầu sửa giao diện với trang login"). This is a hard constraint, not a style preference, and this edit crosses it regardless of how trivial the diff looks.
**Fix**: revert this one line — restore `shadow="md"` on the login Paper so LMS login visuals are unaffected by the Card/Paper doctrine change.

### 2. MEDIUM — incomplete grep left an explicit shadow override outside the doctrine
`packages/ui/src/notification-center.tsx:81` — `<Popover shadow="md" ...>` (the notification-bell dropdown). This is a floating layer functionally identical in role to Menu/Select dropdowns, but it was not touched, and it is now the **only** remaining explicit `shadow="md"`/`"lg"`/`"xl"` override in the entire `apps/` + `packages/ui/src` tree (verified via repo-wide grep — zero other hits). The phase file explicitly required a fresh, non-trusting grep for `shadow=`/`boxShadow`/`withShadow` before considering the audit complete; this instance was missed.
Not a regression (md is still ≥ the sm minimum, so the "never below sm" rule isn't broken), but it is inconsistent with the stated doctrine ("no component defaults to md/lg/xl anymore") and with `design-showcase.tsx`'s new claim that only Modal/Menu/Select/Drawer use `sm` and nothing defaults above it.
**Fix**: either lower to `shadow="sm"` for consistency, or explicitly document Popover as an accepted exception in `design-system.md`'s Elevation table.

### 3. LOW — stale comment
`packages/ui/src/theme.ts:108` — the `shadows: {...}` object header comment still reads `/* Shadows — flat Apple aesthetic, depth only for modals */`, unchanged from before. Individual component comments below it were updated to reference "Zero Elevation," but this one wasn't. Cosmetic only, no functional impact.

### 4. NOTE — TDD provenance unverifiable, but assertions are sound
`theme.test.ts` is a new untracked file with no prior commit capturing "before" values, so it's not possible to confirm a genuine red→green TDD cycle happened (vs. the test being written after the edit to assert final state only). That said, the assertions themselves are specific and meaningful — `toBe('none')`, `toBe('var(--cmc-shadow-sm)')`, and a full `toEqual` on the `shadows` scale — and would fail if any of the 7 components regressed to a wrong value. Not a phantom test. This is a process-confidence gap, not a correctness gap.

## Checks Passed

1. **Doctrine consistency (theme.ts vs tokens.css)**: PASS. Both files agree — Card/Paper/Notification → `none`/flat-border; Modal/Menu/Select/Drawer → `var(--cmc-shadow-sm)`. `--cmc-shadow-sm`'s underlying rgba value is unchanged (only comments updated), so no silent value drift.
2. **Baseline test soundness**: PASS with note (see #4 above) — meaningful, would catch wrong edits.
3. **Scope exclusions (leaderboard.tsx, showcase-view.tsx, student-shell.tsx)**: PASS — verified sound, not under-scoping.
   - `leaderboard.tsx` uses `var(--cmc-kid-shadow)` (a distinct, untouched token still defined at `tokens.css:197-198`) plus inset neumorphic `boxShadow` values for podium/medal 3D relief. This is a genuinely different, load-bearing gamification visual language, not a Card/Paper-style decorative shadow — correctly excluded.
   - `showcase-view.tsx` / `student-shell.tsx` inline shadows are the same kid-gamification neumorphic/hero-drop-shadow pattern — correctly excluded per the same reasoning.
   - `login-gate.tsx` (ERP admin login, distinct from `lms-login-gate.tsx`) was left untouched — correct, consistent with the login-exclusion constraint (contrast with finding #1, which is the one file where this same constraint was violated).
4. **`design-showcase.tsx` regression check**: PASS. `Menu shadow="lg"` → `"sm"` matches doctrine. Shadow Scale demo updated with `usage` labels reflecting the new component-to-token mapping; not stale.
5. **`design-system.md` quality**: PASS. New Elevation section clearly separates decorative (Card/Paper/Notification → none) vs functional (Modal/Menu/Select/Drawer → sm minimum) with a stated rationale (near-white bg contrast). Bucket-B #22 date-format rule (`DD/MM/YYYY` display, ISO only at API boundary) is sound, unambiguous, and consistent with the plan's own scope note that it's a documentation-only rule for this round (code fixes deferred to P4-P7).
6. **Reconciliation pre-step**: PASS. `facility-picker.tsx` / `meetings-panel.tsx` (flagged as pre-existing uncommitted diffs in plan.md) show zero diff now — already committed cleanly in prior commits, not tangled into this change.
7. **Build/test verification**: PASS, re-ran myself.
   - `pnpm --filter @cmc/ui exec vitest run` → 2 files, 14 tests passed (8 new in `theme.test.ts`).
   - `pnpm --filter @cmc/ui exec tsc --noEmit` → clean.
   - `pnpm --filter @cmc/admin exec tsc --noEmit` → clean.
   - `pnpm --filter @cmc/lms exec tsc --noEmit` → clean.

## Unresolved Questions
- None — check #4 (login-exclusion) is resolved definitively: it is a real, if narrow, violation (finding #1), not a false alarm.

Status: DONE
Verdict: NEEDS-FIXES (blocking)

Blocking issues:
1. Revert the `shadow="md"` removal in `packages/ui/src/lms-login-gate.tsx` — restores login-page visual parity per the user's explicit login-exclusion constraint.

Non-blocking (recommended before merge, not required):
2. Resolve the missed `notification-center.tsx` Popover `shadow="md"` override — either normalize to `sm` or document as an intentional exception.
3. Update the stale `theme.ts:108` shadows-object comment for consistency.
