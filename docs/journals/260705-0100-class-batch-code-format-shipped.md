# Class Batch Code Format Redesigned and Shipped

**Date**: 2026-07-05 01:00
**Severity**: Medium
**Component**: Academic domain, batch code generation, Prisma schema
**Status**: Code complete and verified; pending commit coordination

## What Happened

Redesigned and shipped the class batch code format from a simple 4-year counter to a facility+program+year scoped format. Old format: `B-{year}-{seq:0000}` (e.g. B-2026-0007). New format: `[Facility.code]-[ProgramAbbrev]-[YY]-[seq:0000]` (e.g. HQ-UCR-26-0001), with counter keyed to (facilityId, program, year) instead of (facilityId, year). All implementation phases completed: schema migration, domain layer API changes, HTTP routing, integration tests, and decision documentation. Code reviewed (0 findings), integration suite green (107 files, 594 tests passing on live Postgres).

## The Brutal Truth

The technical work is solid — but there's an awkward gap between what was completed and what's actually committed. This session's code is done and tested, but schema.prisma got swept into a concurrent session's unrelated attendance feature commit (82dae64) as a side effect of concurrent file editing without ownership coordination. This means:

1. This session's BatchCodeCounter schema changes (the structural part of the feature) are attributed to commit 82dae64 with message "feat(attendance): manual-WiFi ticket + reason, all-day punch, IP privacy" — technically correct (diffs verified), but factually misleading.
2. This session's remaining 8 changed files (code.ts, code.test.ts, batch-code.ts, class-batch.ts, batch-code-atomicity.int.test.ts, decision doc, index, brainstorm) are still uncommitted.
3. The work is frozen at a partial commit state that obscures which feature owns which schema change.

It's not a data loss or corruption problem — `git show 82dae64 -- schema.prisma` confirms the diffs are intact and correct. But it's a clear illustration of why concurrent agent sessions editing the same repo need explicit file-ownership or synchronization gates.

## Technical Details

**Schema change**: BatchCodeCounter table primary key widened from (facilityId, year) to (facilityId, program, year). Migration 20260705010000 uses TRUNCATE + ALTER TABLE (preserves existing RLS policy) rather than DROP + CREATE.

**Code changes**:
- `packages/domain-academic/src/code.ts`: New PROGRAM_CODE_ABBREV and PROGRAM_ORDER_INDEX constants; formatBatchCode signature changed to accept program parameter.
- `packages/domain-academic/src/code.test.ts`: New tests for program-scoped code generation.
- `packages/domain-academic/src/schedule.test.ts`: Removed stale duplicate test block for old formatBatchCode signature that had drifted into wrong file.
- `packages/api/src/services/batch-code.ts`: nextBatchCode signature updated; advisory-lock key2 now encodes program as (year * 10 + programIndex) instead of raw year.
- `packages/api/src/routers/class-batch.ts`: Create mutation resolves facility.code and course.program server-side before generating code — no public API contract change.
- `packages/api/test/batch-code-atomicity.int.test.ts`: Updated for new format and signature.

**Test results**: 594/594 integration tests pass on live dev Postgres. No typecheck errors in @cmc/domain-academic or @cmc/api. Code reviewer (subagent) returned 0 findings.

## What We Tried

All paths executed successfully on first attempt:
- Phase 1 (schema + decision): Hand-wrote TRUNCATE+ALTER migration to preserve RLS policy (chose this over DROP+CREATE after considering trade-offs).
- Phase 2 (domain layer): Refactored code.ts signature, added program-scoped counter logic, wrote tests.
- Phase 3 (API layer): Updated batch-code service, class-batch router, integration tests.

No rework was needed in this session.

## Root Cause Analysis

The concurrent session incident is not a failure of this session's work — it's a structural weakness in the repository's handling of concurrent agent edits to shared files. Specifically:

1. Two sessions were operating on the same codebase without file-locking or ownership registration.
2. Both sessions edited `packages/db/prisma/schema.prisma` (a high-traffic file that many features touch).
3. Session B (attendance feature) committed first, sweeping in Session A's (this session's) uncommitted schema edits.
4. Session A's code, tests, decision doc, and schema index remain staged but uncommitted, creating a partial state.

This is not a malicious race condition or data loss — git itself worked correctly. But it highlights that the current workflow assumes either sequential sessions or explicit coordination when files overlap. In a future multi-agent setup, file ownership (e.g., "attendance feature owns migrations 20260705*; academic feature owns domain-academic/*") or a pre-commit hook that rejects concurrent edits to certain high-risk files would prevent this.

## Lessons Learned

1. **Shared file edits need explicit coordination**: schema.prisma, package.json, and migration folders should be guarded during concurrent session work. Either enforce sequential edits or require ownership registration.

2. **Partial commits create debugging friction**: When one session's schema edits appear in another session's commit, future developers will waste time tracing why an unrelated feature commit touches BatchCodeCounter. Document the incident clearly to prevent confusion.

3. **Hand-written migrations with side-effect preservation**: The TRUNCATE+ALTER+ALTER approach (vs. DROP+CREATE) was correct and preserved RLS policy, but it's also more fragile to concurrent editing because altering a live table risks lock contention. For future schema work with concurrent sessions, consider a pre-migration validation that the table is empty or unused.

4. **Code-review alone isn't enough for commit attribution**: This session passed code review cleanly (0 findings), but the commit attribution issue wasn't caught. Add a pre-commit check that flags when a commit message doesn't match the files being committed (e.g., commit message says "attendance" but schema.prisma has class-code changes).

## Next Steps

1. **User decision required**: Should the remaining files from this session (code.ts, code.test.ts, batch-code.ts, class-batch.ts, tests, decision doc) be committed as a separate "feat(academic): class batch code format program-scoped" commit, or should they be merged into a new commit that also reattributes the schema changes?

2. **Verify schema migration stability**: Run the 20260705010000 migration on a test replica to confirm no lock contention or RLS drift. (Already passes live dev, but worth checking a clean-slate run.)

3. **Add file-ownership coordination**: For future concurrent work, establish a pre-session file-ownership matrix or add a `.gitignore.session` / `.claude/session-locks` file that agents register when editing high-traffic files.

4. **Update AGENTS.md**: Add a note under "Branch workflow" about coordinating concurrent sessions when editing shared files like schema.prisma, migrations/, package.json.
