---
phase: 3
title: Retrofit ticket-lock decision
status: completed
priority: P1
dependencies: []
effort: S
---

# Phase 3: Retrofit ticket-lock decision

## Overview

Write `docs/decisions/0035-shift-registration-ticket-lock.md` for the shift-registration rule that shipped today (Plan A) but was never previously documented — this is the retrofit that closes the exact gap that caused the incident. Runs FIRST (before Phase 1) so the index can seed with this as its founding entry.

## Requirements

- Functional: decision doc follows `docs/templates/decision.md` structure exactly; number `0035` (next free — highest existing is `0034`, and note the `0032` collision separately, do not reuse it).
- Non-functional: register via `harness-cli decision add`; content must accurately describe the rule AS IMPLEMENTED today (verified in Plan A: `apps/api/src/routers/shift-registration.ts`), not a re-interpretation.

## Architecture

Rule to document (verified against actual shipped code, `apps/api/src/routers/shift-registration.ts`):
1. `create` blocks when caller has any existing registration with `status ∈ {draft, submitted}` (was `submitted`-only before today's fix — this IS the historical gap).
2. `create`, `updateDates`, `submit` all reject `fromDate <= today` (Asia/Ho_Chi_Minh) via `assertFutureFrom()`.
3. `updateDates` mutation: owner-only, `draft`-only, prunes out-of-range `shiftRegistrationEntry` rows in the same transaction, audit-logged.

Context section must state explicitly: this rule existed as unwritten intent from the original 2026-06-30 brainstorm but was never captured in a decision doc or the original plan's API design — the initial implementation shipped an incomplete version (`submitted`-only guard) with no written spec to catch the gap, which is why it went unnoticed until manually caught.

## Related Code Files

- Create: `docs/decisions/0035-shift-registration-ticket-lock.md`
- Reference (read-only, do not modify): `apps/api/src/routers/shift-registration.ts`, `plans/260704-2130-cong-ca-workflow-ux-fixes/plan.md`

## Implementation Steps

1. Copy `docs/templates/decision.md` structure into the new file.
2. Fill `Context`: original brainstorm (2026-06-30) left the rule as an open/unwritten intent; initial shipped code only blocked `submitted`, never `draft`; gap went undetected for the code's lifetime until manually re-reported and fixed today.
3. Fill `Decision`: the 3 rules from Architecture above, stated as the accepted behavior.
4. Fill `Alternatives Considered`: e.g. "only block on submitted (status quo, rejected — allows unbounded draft accumulation)"; "block on any non-terminal status including future statuses (rejected — YAGNI, no such status exists today)".
5. Fill `Consequences`: positive (single source of truth now exists, prevents recurrence); tradeoffs (legacy drafts with past `fromDate` can no longer submit until owner edits dates — already a known behavior change from Plan A).
6. Status: `Accepted` (already implemented and shipped in commit `54b5613`).
7. Register: `harness-cli decision add --id 0035-shift-registration-ticket-lock --title "Shift Registration Ticket Lock" --doc docs/decisions/0035-shift-registration-ticket-lock.md --notes "Retrofit — rule shipped in Plan A (commit 54b5613) but was never documented at brainstorm/plan stage; written up after root-cause investigation."`

## Success Criteria

- [ ] File created, follows template, `Status: Accepted`.
- [ ] `harness-cli decision add` succeeds, queryable via `harness-cli query matrix` or equivalent.
- [ ] Content matches actual shipped code (spot-check against `shift-registration.ts` create/updateDates/submit).

## Risk Assessment

- Low risk — pure documentation, no code/always-loaded-file changes. Safe to run first.
- Must not renumber or touch the pre-existing `0032` duplicate — that's a separate cleanup, out of scope.
