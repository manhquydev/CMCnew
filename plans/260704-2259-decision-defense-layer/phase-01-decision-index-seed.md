---
phase: 1
title: Decision index seed
status: completed
priority: P1
dependencies:
  - 3
effort: M
---

# Phase 1: Decision index seed

> ⚠️ **DO NOT run this phase before Phase 3.** File numbering (1,2,3) does NOT match execution order — real order is 3 → 1 → 2 (see `dependencies` frontmatter above and `plan.md`). Phase 3 creates `docs/decisions/0035-shift-registration-ticket-lock.md` first; this phase's seed must include it as day-one entry #1. Building the index before 0035 exists means re-doing this phase.

## Overview

Create `docs/DECISION_INDEX.md` — a flat, grep-able table mapping code areas to governing decision docs, seeded from all 34 existing decision files (33 unique numbers + 1 duplicate `0032`) plus the new `0035` from Phase 3.

## Requirements

- Functional: one row per `Accepted` decision with clear code mapping; infra/process/meta decisions marked `N/A — infra` (not omitted silently — every decision must appear or be explicitly excluded with reason).
- Non-functional: index is a POINTER table only — one-line rule summary + link, never copy full decision text (avoids the exact duplication-drift risk the brainstorm flagged).

## Architecture

Verified status of all 34 files (via `awk '/^## Status/{getline;getline;print}'` sweep):
- **Superseded**: `0002` (superseded by `0003`) — exclude from index (historical only).
- **Proposed** (not yet accepted): `0015` — include with `Status: Proposed` column value, not `Active`.
- **Accepted, infra/process/meta** (no direct code-file mapping — harness process, CI/CD, benchmark, ClaudeKit adoption, TLS cert, prompt/proposal rules): `0001, 0003, 0004, 0005, 0006, 0007, 0009, 0017, 0018, 0019, 0029, 0032-dev-prod-cicd-environment-split` — mark `N/A — infra` with 1-line reason, do not drop the row.
- **Accepted, business-logic with clear code mapping** (the real payload): `0008` (LMS/certificate), `0010` (Callio/KPI), `0011` (KPI auto+override), `0012` (payroll defaults), `0013` (email Graph), `0016` (SPA routing), `0020` (shift manager ownership), `0021`/`0022` (curriculum/exercise no-RLS), `0023` (payroll director scoping), `0024` (commission/receipt), `0025` (attendance penalty→payroll), `0026` (HR sensitive mask), `0027` (delegated shift approver), `0028` (refund ledger), `0030` (email Brevo split), `0031` (staff password login), `0032-record-detail-primitive-reactive-extension` (record-detail.tsx), `0033` (student login phone identity), `0034` (manual attendance daily ticket), `0035` (shift ticket lock, from Phase 3).
- **`0013`/`0016`/`0033` status extraction returned blank** in the sweep (likely a different heading format, e.g. bold `**Status**` instead of `## Status`) — read these 3 individually to confirm actual status before seeding their row; do not assume `Accepted` without checking.

For each business-logic row, resolve the "Module/File pattern" column by grepping the decision doc's `## Decision`/`## Context` section for concrete file/router/model names already mentioned (most already reference exact files, e.g. `0020` names `EmploymentProfile.managerId` and shift/punch approval) — do not guess; if a decision doesn't name a concrete file, read the linked plan (if referenced) to find it, and if still unclear, mark `Module/File pattern` as the best-known area with a `(verify)` suffix rather than inventing a path.

Duplicate `0032` handling: include BOTH rows, add a footnote directly under the table:
> ⚠️ `0032` is used by two unrelated decisions (`dev-prod-cicd-environment-split` and `record-detail-primitive-reactive-extension`) — numbering collision, not fixed here (renumbering existing files is a separate, human-approved cleanup). File via `harness-cli backlog add --title "decision-number-collision-0032" --pain "..."`.

Table header must include the update-discipline comment mandated by the brainstorm design:
```markdown
<!--
UPDATE RULE: only add or change a row when (a) a new decision doc is created per
docs/FEATURE_INTAKE.md's hard-gate, or (b) the user explicitly confirms a changed
decision mid-work (create a new decision doc that supersedes the old one; update
this row to point at the new doc; do NOT delete the old doc or row history).
Never add a row speculatively without a backing decision doc.
-->
```

## Related Code Files

- Create: `docs/DECISION_INDEX.md`

## Implementation Steps

1. Re-verify status of `0013`, `0016`, `0033` individually (read the files, don't assume).
2. Build the table: columns `Module/File pattern | Rule (1 line) | Decision doc | Status`.
3. Seed all rows per the Architecture classification above (infra rows marked `N/A — infra`, superseded `0002` excluded, `0015` marked `Proposed`).
4. Add `0035` (from Phase 3) as a row — first entry with a fully-verified code-vs-doc match (called out in a short intro note as the founding/reference case).
5. Add the `0032` collision footnote + file the backlog item.
6. Add the update-rule HTML comment at the top of the file (before the table).

## Success Criteria

- [ ] All 34 decisions (+ `0035`) accounted for — either a real row or an explicit exclusion reason, none silently missing.
- [ ] No decision content copied verbatim beyond the 1-line rule summary — table only points, doesn't duplicate.
- [ ] `0032` collision documented + backlog item filed.
- [ ] Update-rule comment present verbatim at the top of the file.

## Risk Assessment

- Main risk: guessing a "Module/File pattern" for a decision that doesn't name one — mitigated by the `(verify)` suffix convention instead of inventing a path.
- Low blast radius — new file only, no edits to existing docs/decisions or always-loaded context files (that's Phase 2).
