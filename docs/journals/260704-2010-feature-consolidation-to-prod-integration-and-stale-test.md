# Consolidating the unmerged feature work to prod (UI rebuild + Plan A/B/C/D)

**Date:** 2026-07-04
**Plan:** `plans/260704-1935-safe-feature-consolidation-integration/`
**Result:** prod `ba41351`, dev `ee2bd9d` — all recent product work is now live.

## The problem

`develop` and `main` were missing all recent product work: the ERP UI rebuild (P1–P7) and Plan
A/B/C/D sat in 5 OPEN, stacked PRs (#27–31), never merged. The dev environment (built from develop)
therefore showed the old UI — which is what tipped the operator off.

## How it was made safe

Research first: a throwaway cumulative trial-merge proved the integration was clean (0 code
conflicts, 1 docs conflict) and that the 4 "plans" were orthogonal siblings (the 150-file "overlap"
was just the identical shared phase-d base). No new DB migrations; no new env vars. Then: backup tags
→ integrate on develop → verify on the live dev env → promote to prod, with a red-team pass that
caught a logically-broken no-loss check (`git diff branch HEAD == 0` is symmetric; corrected to
`merge-base --is-ancestor`) and a rollback that would have re-run a stale pre-split pipeline.

## The one real snag: a stale test, not a lost feature

The first develop build after integration failed on a single deterministic test —
`receipt-batch-course-guard`. It took real digging to classify correctly: the code under test
(`finance.ts`) and the test file were **byte-identical** to develop, where the test was green.
The cause was the *combined* suite: the test asserted a courseId-match guard on `receiptApprove`,
but commit `b1ec5a4` had **deliberately removed** that guard (ClassBatch.courseId is curriculum
content, Receipt.courseId is the billed course — separate catalogs) and replaced it with a
facility-match guard. The old test passed on smaller suites only by a coincidental secondary
rejection, and that coincidence broke once the full 104-file suite ran. Fix: align the stale test
with the intended invariant (a different-course, same-facility batch is allowed; enrollment is
created into the staff-chosen batch). Not a product regression; not weakening coverage.

Lesson: when a merged suite goes red, check whether the code-under-test actually changed before
assuming the merge broke behavior. Here it hadn't — the test was encoding a superseded invariant.

## Prod promote

Bundled the app + the (already-live) CI/CD-split infra in one develop→main merge — verified safe
because the live prod nginx already ran the dev-vhost config byte-identical to the tracked file, so
the deploy's infra steps were idempotent no-ops. The GitHub→Jenkins webhook (registered earlier)
auto-triggered both the develop and main builds — its first real proof on `main`. Prod deployed
`ba41351` with `api-migrate` a no-op, prod DB/Redis untouched (33h uptime), and the co-located dev
stack undisturbed. Backup tags + a pre-promote DB dump were in hand; no rollback needed.
