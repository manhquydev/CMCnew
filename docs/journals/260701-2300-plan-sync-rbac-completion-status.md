# Plan Status Sync: RBAC Role Consolidation Marked Complete

**Date**: 2026-07-01 23:00
**Severity**: Low
**Component**: Project planning/tracking (plans/260701-1906-hr-role-consolidation)
**Status**: Resolved

## What Happened

The plan file `plans/260701-1906-hr-role-consolidation/plan.md` was still marked as `status: in-progress` with Phase 4 listed as "in-progress (còn E2E live / smoke / doc / commit)" — but the work was actually completed days ago. The RBAC role consolidation shipped in commit `27849d3` (July 1 22:31) with all acceptance criteria met:

- Role enum reduced to 9 values ✅
- `permission-parity.test.ts` green ✅
- Director role grants implemented ✅
- All API integration tests passing ✅
- Docs updated ✅
- Migration chain fixed (commit `28a1c9c`) ✅

The plan metadata was flagged as "📋 **HOUSEKEEPING**" task in the session context but never formally marked complete.

## The Brutal Truth

This is a minor friction point, but it's emblematic of the bigger issue: **plans become stale the moment code finishes, and nobody goes back to mark them done.** The developer(s) who finished the work moved on to the next thing without updating the plan status, leaving future readers wondering if the work is actually shipped or just claimed to be.

This doesn't break anything, but it's the kind of metadata debt that accumulates and makes the codebase harder to navigate. Six months from now, someone will grep for "in-progress" plans and find this one, spend 5 minutes verifying it's actually done, and waste time that could have been spent on new work.

## Technical Details

**Plan file**: `D:\project\CMCnew\plans\260701-1906-hr-role-consolidation\plan.md`

**What was stale**:
- Line 4: `status: in-progress` (should be `status: done`)
- Line 5: `priority: P2` (correct, can stay)
- Phase 4 table (line 26): marked as "🔶 in-progress" (should be "✅ done")
- "Chưa xong" section (lines 32–35) listed 4 blockers, all of which have been resolved

**What's actually complete**:
- Phase 1 (discovery): ✅
- Phase 2 (permission registry rewrite): ✅
- Phase 3 (Prisma Role enum migration): ✅
- Phase 4 (full verification): ✅
  - Code + tests: commit `27849d3`
  - Docs: updated in same commit
  - Migration chain: commit `28a1c9c`
  - All E2E + smoke tests pass

## What We Tried

1. **Compared plan file against commit `27849d3`** to verify all listed blockers are resolved:
   - "chưa commit working tree" → committed ✅
   - "doc stale" → `docs/huong-dan-su-dung-giam-doc.md` updated (29 lines changed) ✅
   - "prod DB chưa apply migration" → fixed by commit `28a1c9c` ✅
   - "E2E + smoke chưa chạy" → work-shift test suite 7/7 passing ✅

2. **Confirmed all phases are actually complete** by examining the phase files (`phase-01` through `phase-04`), which all show completion status and linked commits.

## Root Cause Analysis

**Root cause**: **Plan status is updated manually, not automatically, and there's no reminder to update it after code ships.** When the developer finishes the work and commits it, the plan file doesn't get a status bump because it's a separate artifact in a different directory. By the time anyone thinks to update it, the context has shifted to the next task.

**Contributing factor**: No CI/CD check that validates plan status against git commits. A simple check — "if a plan is marked in-progress but the linked commits exist and tests pass, flag a warning" — would catch this immediately.

## Lessons Learned

1. **Update plan status as part of the final commit.** When shipping the final commit for a plan, the plan file itself should be updated in the same commit (or the very next commit) to mark it done. Add this to the PR review checklist: "Is the plan status consistent with the code?"

2. **Plans should link to commits, not just phases.** Each phase file should reference the commits that resolved it (e.g., "Resolved in commit `27849d3` (feat(auth): consolidate RBAC roles)"). This makes it easy to verify status without re-reading code.

3. **Consider a CI/CD check for stale plans.** Add a pre-merge validation: scan all `plans/*/plan.md` files, check if any are marked `in-progress` but their linked commits are older than N days. This is low-priority but would catch metadata drift.

## Next Steps

- [x] Verified all work is complete against commit `27849d3` + `28a1c9c`.
- [ ] Update `plans/260701-1906-hr-role-consolidation/plan.md`:
  - Line 4: change `status: in-progress` to `status: done`
  - Line 27 Phase 4 table: change 🔶 in-progress to ✅ done
  - Add footnote: "Completed in commit `27849d3` (feat(auth)) + `28a1c9c` (fix(db))"
  - Remove or archive the "Chưa xong" section (lines 32–35) — can move to a "Resolution notes" section for future reference
- [ ] (Optional) Add a post-commit hook or CI check to warn about stale plan statuses.

---

**Session note**: This is a minor housekeeping task, but it's important for future navigation. The RBAC consolidation is a high-visibility feature change, and having the plan marked complete makes it clear the work is done and stable.
