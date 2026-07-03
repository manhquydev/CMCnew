# Exec Plan

## Goal

Migrate `staff-profile.tsx` onto `record-detail.tsx` (P2) with zero user-visible behavior change,
extending P2's interface where the red-team found real architectural gaps, rather than working
around them locally.

## Scope

In scope:

- Extend `RecordDetailHandle`/`RecordDetailPanelProps`/`RecordDetailField` (P2) with `data`,
  `onStateChange`, `onFieldChange` — all optional, backward-compatible.
- Migrate `staff-profile.tsx`'s Fieldsets/Tabs/ActivityLog onto `RecordDetailPanel`.
- Re-wire header Save button reactivity + the `roles`→`primaryRole` auto-clear side effect.
- Adapter for `EmploymentTab`/`PayrollTab`'s `{user: StaffProfileUser}` prop shape vs the
  primitive's flat `{data: unknown}` tab contract.

Out of scope:

- Any new field, new business rule, or visual redesign beyond token inheritance from P1.
- Extending P2 beyond what P5 concretely needs (no speculative generality for hypothetical future
  entities).

## Risk Classification

Risk flags: Authorization (role/facility/active-status editing, session invalidation on role
change), Existing behavior (staff-profile.tsx is shipped, working production code), Weak proof
(no automated test coverage exists for staff-profile.tsx or the migration).

Hard gates: Authorization → high-risk lane (this document set).

## Work Phases

1. Discovery — done (red-team review, `plans/reports/` + inline findings in the P5 task notifications).
2. Design — this document set.
3. Validation planning — see `validation.md`.
4. Implementation — P2 extension first (isolated, testable in isolation), then staff-profile.tsx
   migration consuming the extended interface.
5. Verification — typecheck, existing test suite (P2's `record-detail.test.ts` extended for the
   2 new hooks), manual before/after behavior comparison on the running admin app (no automated
   render tests exist for either file — documented gap, not silently ignored).
6. Harness update — record decision 0032, update P2/P5 plan status on completion.

## Stop Conditions

Pause for human confirmation if:

- The `onFieldChange`/`onStateChange` extension turns out to need a 3rd primitive change not
  anticipated here.
- Manual verification reveals any behavior difference from the pre-migration page.
- Any change appears to affect authorization checks beyond what's documented here (the migration
  must not alter WHO can edit WHAT — only how the UI is implemented).
