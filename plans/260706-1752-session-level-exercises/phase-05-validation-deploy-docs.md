# Phase 05: Validation, Deploy, Docs

## Requirements

- Focused tests pass first, then broader typecheck/integration as needed.
- Deploy develop and prod only after green local/Jenkins-suitable proof.
- Update docs/journal/watzup.

## Files

- Modify: `docs/operate-and-test-guide.md`
- Modify: `docs/specs/phase-02-assessment-lms.md`
- Modify: `docs/DECISION_INDEX.md`
- Create/update: validation report under `plans/reports/`

## Commands

```text
pnpm --filter @cmc/db generate
pnpm --filter @cmc/api test:integration -- <focused tests>
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/lms typecheck
pnpm --filter @cmc/e2e test -- <focused spec>
```

## Success Criteria

- Harness story proof updated.
- Dev/prod smoke evidence recorded.
- Journal/docs/watzup written.
