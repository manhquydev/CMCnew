# Code Review — Phase 5: Detail/record pages restyle

Date: 2026-07-04
Reviewed against: `plans/260703-2351-erp-admin-reskin-core3/phase-05-detail-record-pages.md`,
`reports/fullstack-developer-260704-0217-phase5-detail-record-pages-report.md`

## Scope

- Files: `packages/ui/src/record-detail.tsx`, `apps/admin/src/opportunity-detail.tsx`,
  `apps/admin/src/profile-settings-panel.tsx`, `apps/admin/src/schedule-detail.tsx`,
  `apps/admin/src/staff-profile.tsx`, `apps/admin/src/student-detail.tsx`
- Method: read every `git diff` hunk for all 6 files line-by-line (not just stat), grepped for
  the sensitive symbols named in the review brief, re-ran typecheck/test/lint independently.

## Overall Assessment

The implementing agent's claims check out. This is a clean, styling-only restyle. The
highest-risk item — that `opportunity-detail.tsx` carries unrelated live business logic
(receipt-create Modal with class-batch selection) in the same file being restyled — was
verified with full diff inspection, not a spot check. No overlap found.

## Critical Issues

None.

### Check 1-3: `opportunity-detail.tsx` Modal/business-logic isolation — VERIFIED CLEAN

Full `git diff apps/admin/src/opportunity-detail.tsx` is exactly 104 lines, confined to:
- Rewriting the local `Field` helper (label width/alignment) and adding a new
  `SectionHeading` helper (both above the `StageBar`/Modal code, well outside any JSX return).
- Three `Card radius="md"→"sm"` / `p="md"→"lg"` swaps plus `Title` → `SectionHeading` on the
  "Thông tin liên hệ", "Phân bổ & nguồn", and "Phiếu thu của tôi" cards — all confirmed to sit
  outside the receipt-create Modal (the stage-bar card and the two `SimpleGrid` cards above the
  `canCreateReceipt && ownReceipts.length > 0` block).

Grep for `receiptClassBatchId|classBatches|createOpportunityReceipt|Promise\.all` against the
current working file and against `git show HEAD:...` (pre-existing committed version) returns
identical symbol sets at a uniform +26-line offset (from the new `SectionHeading` function added
earlier in the file) — i.e. every line number shifted by exactly the same delta, proving no
insertions/edits happened between them. The Modal JSX, `receiptClassBatchId`/`classBatches`
state, and `createOpportunityReceipt` function body are byte-identical to `HEAD`. Claim confirmed.

## High Priority

None.

## Medium Priority

None.

## Low Priority

- `record-detail.tsx`: the right rail switched from Mantine `Grid`/`Grid.Col` (responsive
  breakpoint-based `span={{ base: 12, md: 8/4 }}`) to a bare `flex-wrap` layout with fixed
  `flex: 1 1 480px` / `flex: 0 1 var(--cmc-chatter-w)` basis. This is a reasonable wireframe-driven
  choice and the report's stated rationale (natural single-column fallback without a media query)
  is plausible, but it changes the actual breakpoint math (was Mantine's `md` token; now purely
  content-based wrapping at ~480px+340px+gaps ≈ 836px+ viewport width). Since `record-detail.test.ts`
  has no render assertions, this responsive behavior is untested either before or after — not a
  regression introduced by this phase, just a pre-existing gap worth flagging for the deferred
  visual-QA pass.
- Report explicitly flags GitNexus MCP tools were unavailable this session and substituted
  grep/git-diff analysis. That substitution was adequate for this task's actual risk (styling
  diffs, verified above), but the absence itself is a process gap outside this reviewer's scope
  to fix — worth the user checking `claude mcp list` per the report's own flag.

## Edge Cases Found by Scout

- None beyond the responsive-breakpoint note above. All 5 consumer-panel diffs were read in full
  (`student-detail.tsx` 168-line diff, `schedule-detail.tsx` 105-line diff,
  `profile-settings-panel.tsx` 91-line diff, `staff-profile.tsx` 58-line diff) — confirmed each is
  scoped to label/heading/radius/padding changes plus (for `staff-profile.tsx` and
  `profile-settings-panel.tsx`) purely additive avatar/badge JSX blocks. No data-fetching,
  tab-switching, mutation, permission-check, `Switch`/`toggleNotif`, or SSO/logout logic appears
  in any diff hunk.

## Verified Claims

1. **`record-detail.tsx` test integrity** — `record-detail.test.ts` has zero diff (confirmed via
   `git diff --stat`); it only exercises pure helper functions (`resolveOptions`, `displayValue`,
   `getValidationError`, `applyFieldChange`), so no render-assertion lock existed to break. Report
   did not modify the test to accommodate a change — correct, since none was needed.
2. **`staff-profile.tsx` additive-only avatar block** — diff is a single new `Card` (128px
   `InitialsAvatar`, status dot gated on pre-existing `view.isActive`, `StatusBadge pill` role
   chips) inserted between the existing Modal and `RecordDetailPanel`. No existing JSX, state, or
   handler lines were touched.
3. **`student-detail.tsx`, `schedule-detail.tsx`, `profile-settings-panel.tsx` styling-only** —
   confirmed via full diff read. `profile-settings-panel.tsx`'s `Switch`/`toggleNotif` state and
   the SSO/logout `Button` are outside all diff hunks (untouched). Only `SectionCard` heading,
   `Field` label convention, and a new header `InitialsAvatar`/`StatusBadge` swap were changed.
4. **Consumer-count claim (`RecordDetailPanel` has exactly 1 real consumer)** — grep for
   `RecordDetailPanel|RecordDetail\b` across `apps/admin/src` returns exactly 2 file hits:
   `staff-profile.tsx` (real import/usage) and `profile-settings-panel.tsx` (a comment stating
   "Bespoke form, NOT RecordDetailPanel" — confirms the panel deliberately does *not* use the
   primitive). Claim verified true.
5. **Verification commands** — independently re-ran and confirmed:
   - `pnpm -w typecheck` — 12/12 packages pass (cache-hit, consistent with unchanged-since-last-run
     file hashes).
   - `pnpm --filter @cmc/ui test` — 5 files, 55 tests pass (`record-detail.test.ts` 15/15).
   - `pnpm --filter @cmc/admin test` — 4 files, 27 tests pass.
   - `eslint` on all 6 changed files individually (`packages/ui/src/record-detail.tsx` +
     `apps/admin/src/{opportunity-detail,profile-settings-panel,schedule-detail,staff-profile,
     student-detail}.tsx`) — zero errors/warnings.

## Positive Observations

- The agent flagged its own tooling gap (GitNexus MCP unavailable) transparently rather than
  silently skipping the CLAUDE.md-mandated impact analysis, and substituted a reasonable
  grep/diff-based equivalent — appropriate escalation per this project's `DONE_WITH_CONCERNS`
  status protocol.
- The report's own "caution zone" framing around `opportunity-detail.tsx` and explicit statement
  of what was checked (`git diff | grep receiptClassBatchId|classBatches|Modal`) matches what this
  review independently reproduced.

## Recommended Actions

1. None blocking — phase 5 is safe to consider complete.
2. Non-blocking: schedule the deferred visual/Playwright QA pass against wireframe crops #9/#4/#1
   before merge, per the report's own flag (no browser-automation tool was available this
   session).
3. Non-blocking: verify GitNexus MCP registration for future sessions per CLAUDE.md's mandatory
   `gitnexus_impact`/`gitnexus_detect_changes` requirement — two consecutive phase reports now
   note the tools were absent from the session tool list.

## Metrics

- Files reviewed: 6 (full diff read, not sampled)
- Lint issues: 0
- Typecheck: 12/12 packages pass
- Tests: 82/82 pass (55 `@cmc/ui` + 27 `@cmc/admin`)

## Unresolved Questions

- None blocking. Confirm with the user whether the GitNexus MCP absence (flagged twice now) needs
  a harness-config fix before Phase 6.
