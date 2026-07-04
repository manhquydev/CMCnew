# Code Review: Phase 4 batch 3 (FINAL) — lists/tables/kanban re-skin

## Scope
- Plan: `plans/260703-2351-erp-admin-reskin-core3/phase-04-lists-tables-kanban.md`
- Report reviewed: `reports/fullstack-developer-260704-0900-phase-04-batch3-list-panels-report.md`
- 15 files reviewed (16th, `shift-config-panel.tsx`, confirmed correctly out of scope)
- **Verification constraint**: Bash tool was completely non-functional this session (same
  `/usr/bin/bash: -c: line 197: unexpected EOF` failure as reported by the implementing agent,
  reproduced independently on trivial commands like `echo hello`). No PowerShell tool was available
  in my toolset either. `pnpm -w typecheck`, ESLint, `pnpm --filter @cmc/admin test`, and `git diff`
  could **not** be re-run or independently confirmed — all findings below are from static
  read/grep verification only.

## Overall Assessment
The diff is styling-only across all 15 files as claimed. No mutation, query, validation, or
business-logic function bodies were touched. The orchestrator's `class-workspace.tsx`/`grading.tsx`
fix (inlining labels into `StatusDef` objects) is complete and clean — no leftover references to
the removed label consts, no orphaned `Badge` imports. One real (small) finding below on tone
semantics in `grading.tsx`.

## Findings

### 1. `grading.tsx` — `SUB_STATUS_MAP` comment claims "blue→pending" but `pending` tone is amber (should-fix)
`packages/ui/src/status-badge.tsx` defines `pending: { color: 'cmcAmber', ... }` — amber, not blue.
`grading.tsx` line 42's comment says "Preserves original color semantics: gray→draft, blue→pending,
teal→active," then maps `submitted → tone: 'pending'`. Two possibilities, and I could not
distinguish which without the original diff (git access blocked this session):
- The comment is simply wrong (submitted was actually amber/orange originally, matching the
  `kpi-evaluation-panel.tsx` convention in the same batch where "pending" is explicitly used for an
  original **orange**, not blue) — in which case this is a harmless doc typo.
- The tone choice is wrong and an originally-**blue** "submitted" badge now renders amber — a real
  visual regression, and the correct tone would have been `info` (color: `cmc`, brand blue),
  consistent with `EX_STATUS_MAP`'s and `KPI_STATUS_MAP`'s own "blue→info" convention used
  elsewhere in this same batch.
Given the batch's own established convention (blue always maps to `info`, amber/orange always maps
to `pending`), the comment is self-inconsistent with the rest of the batch's work and needs the
orchestrator to check the pre-edit source (or `git show` on the parent commit) to confirm which is
correct, then either fix the comment or fix the tone.

### 2. Verification gap is real and outstanding (should-fix, process not code)
Across all 3 batches, `pnpm -w typecheck`/lint/tests/Playwright have never been run this session
due to the Bash tool defect — this is now a 3-batch-long unverified gap for the entire Phase 4 work.
This must be run in a working shell before merge; static review is not a substitute for a real
compile/test pass, especially given `noUncheckedIndexedAccess` already caused 2 real compile errors
in this same phase that static reading alone would not have caught.

## Verified Clean (spot-checked in depth)
- **`class-workspace.tsx`**: `STATUS_COLOR`/`STATUS_LABEL`/`SESSION_STATUS_LABEL` fully removed, zero
  grep hits. `SESSION_STATUS_MAP` is applied only inside `SessionsTab`'s table (keyed on
  `trpc.schedule.listSessions` rows), not the class-batch table — batch rows correctly use the
  separate `BATCH_STATUS_MAP`. `SegmentedControl` filter labels (`Đã lên kế hoạch`, `Đang mở`, `Đang
  học`, `Đã đóng`, `Đã hủy`) match `BATCH_STATUS_MAP` labels exactly, no typos. `Badge` import fully
  removed with zero remaining usages. `.mutate(`/`classBatchId`/`useEffect` surfaces present and
  structurally intact (32 occurrences, consistent with an unmodified business-logic surface).
- **`grading.tsx`**: no leftover `EX_STATUS_LABEL`/`SUB_STATUS_LABEL`/`*_COLOR` consts. `doGrade`,
  `doPublish`, `trpc.grade.*`/`trpc.submission.*`, `PdfAnnotator` untouched.
- **`session-evidence-panel.tsx`**: `publish()`/`saveDraft()`/`persistDraft()`,
  `trpc.sessionEvidence.upsertDraft.mutate`/`.publish.mutate`, photo upload state, and the
  `enabled` prop gating are all untouched — only the header status badge and roster name cell
  were restyled.
- **`my-payslips-panel.tsx`**: zero calculation logic in the file (display-only component); fallback
  behavior for an unmapped status (`{label: status, tone: 'inactive'}` per `StatusBadge`'s own
  default) genuinely matches the claimed original `{label: s.status, color: 'gray'}` fallback.
- **`shift-reg-detail-panel.tsx`**: `toggle()`/`handleSubmit()`/`handleWithdraw()` (incl. the
  rollback-on-failure comment/logic at line 119) untouched.
- **`kpi-evaluation-panel.tsx`**: `StatusTone` truly has no orange equivalent (6-tone enum:
  active/pending/inactive/rejected/draft/info) — `pending` (amber) is the closest reasonable
  substitute for the original orange `confirmed` status; this judgment call is sound. Category
  `Badge` (block: sales/other, violet/cyan) correctly left untouched and its import preserved.
- **`badge-panel.tsx`, `reconcile-worklist.tsx`, `terms-panel.tsx`, `cskh-panel.tsx`**: sampled in
  full — all mutations (`badgeApi.create/archive/grant`, `finance.receiptReconcile`,
  `assessment.termLock/termUnlock/termCreate/termUpdate`, `transition()`) untouched; status/name
  cells are the only changed surface; `cskh-panel.tsx`'s `studentId`-optional guard on
  `InitialsAvatar` is correct.

## Recommended Actions
1. **Should-fix**: resolve the `grading.tsx` `SUB_STATUS_MAP` "blue→pending" comment/tone
   inconsistency — check original `SUB_STATUS_COLOR` value for `submitted` and either correct the
   tone to `info` (if it was blue) or correct the comment (if it was amber/orange, matching the
   `kpi-evaluation-panel.tsx` precedent).
2. **Blocking before merge**: run `pnpm -w typecheck`, ESLint, `pnpm --filter @cmc/admin test`, and
   `git diff --stat` in a working shell — none of this has been verified by tooling across any of
   the 3 batches of Phase 4.
3. Recommend a Playwright visual diff vs wireframes #11/#12 before marking the whole 8-phase plan
   complete, per the plan's own validation section.

## Unresolved Questions
- What was the original (pre-batch) color for `SUB_STATUS_MAP`'s `submitted` status in
  `grading.tsx`? Needed to resolve finding #1 — I could not access git history this session due to
  the Bash tool outage.
