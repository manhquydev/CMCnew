## Code Review Summary — Phase 4 batch 1 (lists/tables/kanban restyle)

### Scope
- Files: `apps/admin/src/{crm-panel,students-panel,guardians-panel,finance-panel,contact-directory-panel}.tsx`
- `student-management-panel.tsx` spot-checked — no `DataTable`/`Table` usage, "not applicable" claim confirmed accurate.
- Verification method: `git diff` per file (full read, not stat), prop-signature cross-check against `packages/ui/src/{avatar-initials,status-badge}.tsx`, forced (no-cache) `tsc --noEmit`, forced `vitest run`, `eslint` on the 5 files.

### Overall Assessment
Report's claims hold up under independent verification. All 5 diffs are styling-only. No business-logic regression found in `finance-panel.tsx` approve flow or `crm-panel.tsx` kanban/stage-transition logic.

### Critical Issues
None.

### High Priority
None. Specifically verified and cleared:
1. **`finance-panel.tsx` approve-flow isolation** — full diff read (43 changed lines total). Changes are: import additions (`StatusBadge`, `InitialsAvatar`, `StatusDef`), removal of unused `Badge` import, `STATUS` map converted `{label,color}` → `{label,tone}` (StatusDef), and the receipts table's status cell (`Badge`→`StatusBadge pill`) + student-name cell (plain text → `InitialsAvatar`+name). `onApproveClick`, `skipApproveEmail`, `confirmApproveWithEmail`, `approve`, `markSent`, `reconcile`, `doCancel` function bodies and the approve-email Modal JSX are outside the diff hunks entirely — zero lines touched. Confirmed by reading the full diff, not by trusting the report's grep claim.
2. **`STATUS` map value-mapping preserved**: draft→draft(gray-equiv), approved→active(teal-equiv), sent→info(blue-equiv), reconciled→active(green-equiv), cancelled→rejected(red-equiv). Same receipt statuses map to the same semantic meaning; only the representation changed from ad-hoc `color` string to `StatusTone` enum consumed by `StatusBadge`.
3. **`crm-panel.tsx` `OppKanban`**: diff confined to `radius="md"→"sm"`, `InitialsAvatar` insertion on owner line/column, and `pill` prop addition to `StatusBadge` calls. No `.mutate(`, `trpc.`, drag-drop, or filter/query lines appear in the diff. Confirmed via direct diff read.
4. **`guardians-panel.tsx` matched/unmatched logic**: the underlying boolean logic (`r.matchedStudentId ? ... : r.candidates.length > 0 ? ... : ...`) is unchanged — only the two ad-hoc `Badge` elements were swapped for `StatusBadge ... pill` with `tone="active"`/`tone="inactive"`. Ternary structure and conditions are byte-identical.
5. **`InitialsAvatar`/`StatusBadge` prop correctness**: cross-checked against `packages/ui/src/avatar-initials.tsx` (`{name, size, src}`) and `packages/ui/src/status-badge.tsx` (`{status, map, label, tone, withDot, size, pill}`, `StatusTone = 'active'|'pending'|'inactive'|'rejected'|'draft'|'info'`). All usages across the 5 files use valid prop names and valid tone values — no typos, no silent no-ops.

### Medium Priority
None found in this batch.

### Low Priority
- `guardians-panel.tsx`: `StatusBadge status="matched"` / `status="unmatched"` pass a literal string as `status` while also supplying `label`+`tone` directly — `status` value is functionally unused (no `map` prop given) but harmless; matches existing pattern elsewhere in the codebase (e.g. `crm-panel.tsx`'s `status={st.label}`).

### Edge Cases Found by Scout
None beyond what the report already flagged (Playwright visual verification not run — acknowledged gap, not a code defect).

### Verification Results (independently run, not trusted from report)
- `npx turbo run typecheck --filter=@cmc/admin --force`: pass, 25.5s (cache bypassed).
- `npx turbo run test --filter=@cmc/admin --force`: pass, 27/27 tests, 4 files (cache bypassed).
- `npx eslint` on all 5 changed files: zero output, clean.
- `student-management-panel.tsx` read in full: confirmed plain `Tabs` wrapper, no `DataTable`/`Table` usage — "not applicable" claim accurate.

### Positive Observations
- Report's own verification methodology (grep for `mutate|trpc\.|onApprove|...`) was directionally correct but a grep-only check can miss context; this review re-verified by reading full diff hunks directly, which is stronger evidence and confirms the same conclusion.
- Batch-2 deferral (33 remaining panels) is explicitly listed with candidates and cross-reference note to avoid double-touching Phase 3/5/6-owned files — good scope hygiene, no silent drop.

### Recommended Actions
1. No blocking fixes required. Batch 1 is safe to proceed toward commit.
2. Before marking Phase 4 fully done in `plan.md`, run the Playwright visual pass against wireframes #11/#12 as the report itself flags (DONE_WITH_CONCERNS is the correct status — do not upgrade to DONE without that pass).
3. Batch 2 scoping decision needed from plan owner (continue vs. new phase) — no code action needed from review side.

### Metrics
- Type Coverage: n/a (no new `any`/type-safety changes; `StatusDef`/`StatusTone` types reused from existing `@cmc/ui` exports)
- Test Coverage: unchanged; 27/27 `@cmc/admin` unit tests pass (no new tests added for pure styling change — acceptable per YAGNI, no new logic to cover)
- Linting Issues: 0

### Unresolved Questions
None — all checks in the review brief (items 1-9) were completed and confirmed.
