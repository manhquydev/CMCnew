## Code Review Summary

### Scope
- Files: `apps/admin/src/payroll-panel.tsx`, `attendance-roster.tsx`, `shift-reg-list-panel.tsx`,
  `facility-network-panel.tsx`, `certificate-panel.tsx` (all 5 read in full, current worktree state).
- Plan: `plans/260703-2351-erp-admin-reskin-core3/phase-04-lists-tables-kanban.md` (batch 2 of 8).
- Report reviewed: `reports/fullstack-developer-260704-0810-phase-04-batch2-list-panels-report.md`.
- **Environment blocker**: the Bash tool is completely non-functional this session — every
  invocation (`ls`, `pwd`, `git --version`, `echo hi`, even with `dangerouslyDisableSandbox: true`)
  fails identically with `/usr/bin/bash: -c: line 197: unexpected EOF while looking for matching`.
  This independently reproduces the implementing agent's reported blocker. **No `git diff` was
  available, and `pnpm -w typecheck` / `pnpm --filter @cmc/admin test` / eslint could NOT be run.**
  Task item #8 (tooling verification) is therefore unresolved — see Blocking section.
- In lieu of a diff, review was done by reading each full current file, cross-referencing
  `packages/ui/src/status-badge.tsx` (tone→color table) and `theme.ts` (color hex values), the
  Prisma schema/migration for `ShiftRegStatus`, and `apps/api/src/routers/shift-registration.ts`
  for the actual status-transition semantics.

### Overall Assessment
The 5 files are consistent with the claimed scope: only cell-level JSX (status badges, name+avatar
cells) changed. No mutation, computation, or authz logic appears touched in any of the 5 files —
all `.mutate(`/`.query(` call sites, guard conditions, and business logic read as complete and
correct end-to-end (no truncated functions, no dangling calls). `compensation-panel.tsx` was
spot-checked per instruction #7 and is genuinely untouched/inapplicable (no person-name or
status column — only a version-recency `Badge`, correctly left alone).

### Critical Issues
None found in the 5 changed files.

### High Priority
**Tooling verification never happened (blocking for merge, not a code defect).** Neither this
review nor the implementing agent could run `pnpm -w typecheck`, `pnpm --filter @cmc/admin test`,
or eslint — Bash is broken at the environment level this session. Static reading strongly suggests
the changes are safe, but static reading is not a substitute for the type checker (e.g. `StatusDef`
map exhaustiveness, `InitialsAvatar` prop types) or the test suite. **Do not merge this batch until
someone runs these three checks in a working shell.**

### Medium Priority
1. **`payroll-panel.tsx` STATUS_LABEL tone mapping — verified semantically correct.** Traced
   `draft→draft(gray)`, `finalized→info(cmc/blue #0071E3)`, `paid→active(green)` against
   `status-badge.tsx`'s `TONE` table and `theme.ts`. This matches the untouched
   `PeriodSummaryCard` text colors in the same file (`c="gray"` draft, `c="blue"` finalized,
   `c="green"` paid, lines 136/140/144) — strong internal corroboration that gray/blue/green
   semantics are preserved exactly as claimed.

2. **`shift-reg-list-panel.tsx` — `cancelled→'rejected'` tone is a semantic mismatch worth a
   second look.** The report claims this preserves "gray/blue/green/orange" 1:1, but the `rejected`
   tone renders **red** (`cmcRed`), not orange — there is no `StatusTone` value that renders orange.
   More importantly, per `apps/api/src/routers/shift-registration.ts` (lines 407, 434–443):
   the `reject` mutation actually sets status back to **`draft`** (with a `rejectReason` note) —
   it never produces a `'rejected'` status. The `'cancelled'` status is set only when a *new*
   registration supersedes an overlapping one (line 407, `superseded_by`/`supersededAt`). So
   `'cancelled'` semantically means "superseded/withdrawn," not "rejected by an approver," yet the
   new code maps it to the `rejected` tone name. The **displayed label is still correct**
   ("Đã hủy" = Cancelled) so this is not user-visible incorrect data — it's an internal tone-naming
   mismatch, and red is a defensible color choice for "cancelled" regardless. Non-blocking, but the
   report's claim of "exact" 1:1 preservation of the old color scheme is not fully verifiable
   (no diff available) and the "orange" claim doesn't match any tone this component can render.

3. **`certificate-panel.tsx` — new minor inefficiency, not present before.** The cert-list row
   (lines 127–128) now calls `studentName(c.studentId)` twice per row (once for
   `InitialsAvatar name=`, once for the adjacent `Text`), where `studentName` is an O(n) `.find()`
   over the `students` array (line 49-52). Previously this was very likely a single call per row.
   With N certs and M students this doubles the `.find()` work under render. Low real-world impact
   (list sizes are small) but easy to avoid:
   ```tsx
   const name = studentName(c.studentId);
   ...
   <InitialsAvatar name={name} size={22} />
   <Text size="sm">{name}</Text>
   ```

### Low Priority
None beyond the above.

### Edge Cases Found by Scout
- `payroll-panel.tsx`: confirmed all money-affecting code paths (`ComputeForm.compute`,
  `CommissionOverrideModal.submit`, `AttendanceDeductionOverrideModal.submit`, `handleBulkPay`,
  `action()`, and the finalize/mark-paid/reopen button handlers) are intact and unmodified —
  read the full 945-line file, no truncation, no altered branch conditions, no changed mutate
  payload shapes.
- `facility-network-panel.tsx`: pre-existing authz check (`!me.isSuperAdmin && !me.roles.includes('giam_doc_kinh_doanh')`)
  is untouched by this diff — noted for completeness, not a new finding.
- `InitialsAvatar`/`StatusBadge`/`StatusDef` are all exported from `packages/ui/src/index.tsx` and
  prop shapes (`name`, `size`, `status`, `map`) match every call site across the 5 files.
- No `React.CSSProperties`-without-import pattern issue found to be new — it's a pre-existing
  convention already present identically in 18 other `apps/admin/src/*.tsx` files repo-wide
  (`grep` count), so out of scope for this batch.

### Positive Observations
- The implementing agent's own report already flags the tooling gap and correctly declines to
  claim more confidence than static review supports (`DONE_WITH_CONCERNS`), which matches what I
  independently found.
- The 3 "inapplicable" skips (`compensation-panel.tsx`, `checkin-panel.tsx`, `courses-panel.tsx`)
  hold up: spot-checked `compensation-panel.tsx` in full — genuinely no person-name/status column,
  only a recency `Badge` consistent with batch 1's precedent.

### Recommended Actions
1. **Blocking**: run `pnpm -w typecheck`, `pnpm --filter @cmc/admin test`, and eslint on the 5
   files in a working shell session before merging this batch — required by the plan's own
   validation section and never yet executed by anyone.
2. Should-fix: hoist the duplicate `studentName(c.studentId)` call in `certificate-panel.tsx` to a
   single `const`.
3. Optional/non-blocking: reconsider whether `'cancelled'` in `shift-reg-list-panel.tsx` should map
   to a tone name that better reflects "superseded/withdrawn" rather than `'rejected'` — cosmetic
   only, current red rendering is not wrong, just not literally "rejected."

### Metrics
- Type Coverage: not measured (typecheck could not run this session).
- Test Coverage: not measured (test suite could not run this session).
- Linting Issues: not measured (eslint could not run this session).

### Unresolved Questions
- Was the pre-diff `'cancelled'` badge actually orange, or was the implementing agent's report
  description approximate? Cannot confirm without `git diff`/`git log`, which were unavailable
  this session due to the broken Bash tool.
- Confirm in a working session whether `pnpm -w typecheck` passes cleanly for all 5 files — this
  review's confidence is based on static reading only.
