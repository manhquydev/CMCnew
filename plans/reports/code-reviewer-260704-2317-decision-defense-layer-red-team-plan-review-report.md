# Red-team review — Decision Defense Layer plan (pre-implementation, no code exists yet)

Scope: `plans/260704-2259-decision-defense-layer/{plan.md, phase-01,02,03}.md` + source brainstorm. Verified against live `AGENTS.md`, `CLAUDE.md`, `docs/decisions/*` (34 files), `apps/api/src/routers/shift-registration.ts`, `.claude/rules/review-audit-self-decision.md`, `docs/templates/decision.md`, and `harness-cli decision add`/`backlog add` CLI help.

## Verdict

No blocking defect found in the plan's factual claims. All spot-checked facts (decision statuses, the `0032` duplicate, the shift-registration behavior, the CLI syntax, the cross-reference anchor) check out against the live repo. Two **Important** process gaps remain that should be fixed in the phase files before an implementer runs them, plus one documentation completeness gap in Phase 2's stated file structure.

---

## Important

### 1. Phase 2's "current structure" snippets omit the `HARNESS:BEGIN/END` and `gitnexus:start/end` HTML marker comments — plan text is incomplete, not wrong

Live `CLAUDE.md` actually looks like:
```
# Project Rules
<!-- HARNESS:BEGIN -->
## Harness
...
@AGENTS.md
@docs/FEATURE_INTAKE.md
...
<!-- HARNESS:END -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence
...
<!-- gitnexus:end -->
```
Live `AGENTS.md` has the same `<!-- HARNESS:BEGIN -->`/`<!-- HARNESS:END -->` pair around `## Harness` only, and `<!-- gitnexus:start -->` immediately before `# GitNexus`.

Phase-02's "Architecture" section (lines 23-49) quotes both files' structure but never mentions these four marker comments. Functionally this is **not dangerous** — the plan's insertion point (after `## Harness`'s content / after `## ClaudeKit usage`, before `# GitNexus`) lands in the free zone *between* `<!-- HARNESS:END -->` and `<!-- gitnexus:start -->`, outside both marker-delimited blocks, so it will not be clobbered by whatever regenerates the GitNexus block (`npx gitnexus analyze`, referenced in both files as running via a post-commit/post-merge hook). But the plan's own "verified from live file" claim (line 23, line 37) is stale/incomplete — it under-quotes what's actually there. An implementer trusting the plan's literal quoted block for a find-and-replace edit could either fail to match (safe failure) or, worse, manually "clean up" the markers thinking they're unrelated clutter, which would break the regeneration boundary.

**Fix before Phase 2 executes:** update the phase file's Architecture section to show the real structure including the four marker comments, and add one line to Implementation Steps: "confirm the insertion lands strictly between `<!-- HARNESS:END -->` and `<!-- gitnexus:start -->` in both files — do not add/remove/move any `<!--` marker line."

### 2. Phase numbering (1,2,3) vs. real dependency order (3→1→2) is only stated in `plan.md`, not inside the phase files themselves

`plan.md` line 36 bolds "Real execution order (dependencies, not phase numbers): 3 → 1 → 2" and the frontmatter dependency fields are correct (`phase-01: dependencies: [3]`, `phase-02: dependencies: [1]`, `phase-03: dependencies: []`). But if an implementer (human or agent) opens `phase-01-decision-index-seed.md` directly — which is a very plausible entry point given the numbered filename — there is no inline warning inside that file telling them to check phase 3 first. Frontmatter `dependencies: [3]` is only useful if the executing agent/tool actually parses and enforces frontmatter dependencies; nothing in this repo's tooling was confirmed to do that (no `harness-cli phase run` or similar was found/verified).

Concrete failure scenario: an agent picks up `phase-01-decision-index-seed.md` in isolation (e.g. resumed from a task list ordered by filename), builds the index table without decision `0035` existing yet, ships an index that's missing its "founding/reference case" row, and phase-01's own success criterion #1 ("All 34 decisions + 0035 accounted for") silently fails or gets fudged by inventing content for a doc that doesn't exist yet.

**Fix:** add a one-line banner at the top of `phase-01-decision-index-seed.md`'s body (not just frontmatter): "Do NOT run before Phase 3 (`phase-03-retrofit-ticket-lock-decision.md`) completes — this phase seeds decision `0035` created there."

---

## Minor / Informational

### 3. No automated verification for Phase 2's markdown/frontmatter integrity — manual read-back only
Success criterion #4 ("A fresh Claude Code session (or `cat` of both files) renders without markdown/frontmatter errors") has no concrete check attached beyond "diff shows only insertion." For a two-file, always-loaded-context edit this is probably acceptable given the insertion is a small, self-contained markdown block with no frontmatter of its own — but if the team wants a stronger gate, a trivial `git diff --stat` line-count check (expect exactly N inserted lines, 0 deleted) would be cheap and catch accidental corruption better than eyeballing.

### 4. `0014` is missing from the decision-number sequence (jumps 0013→0015) — not addressed by the plan, but also not a real gap
Verified: `docs/decisions/` has no `0014-*.md` file. The plan's arithmetic (33 unique numbers + 1 duplicate `0032` = 34 files) is internally consistent and already accounts for this gap implicitly (it never claims 0014 exists). No action needed, but worth a one-line footnote in the index next to the `0032` collision footnote so a future reader doesn't wonder if `0014` was silently dropped from the index by mistake.

---

## Fact-check results (all PASS — no plan claim found to be wrong)

| Claim | Verified against | Result |
|---|---|---|
| `.claude/rules/review-audit-self-decision.md` has a `## User Decisions` heading | live file, line 11 | PASS — exact heading match |
| `docs/templates/decision.md` exists | `docs/templates/` listing | PASS |
| `harness-cli decision add --id --title --doc --notes` syntax | `harness-cli.exe decision add --help` | PASS — flags match exactly |
| `harness-cli backlog add --title --pain` syntax | `harness-cli.exe backlog add --help` | PASS |
| `0015` is `Proposed`, not `Accepted` | `docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md` line 7 | PASS |
| `0002` is `Superseded by 0003` | live file line 7 | PASS |
| `0032` duplicate is real (two unrelated Accepted decisions) | both `0032-*.md` files, both `Status: Accepted` | PASS |
| `0013`/`0016`/`0033` status-extraction blank in awk sweep is plausible | all three use `- **Status:**`/`Status: accepted` inline format, not the `## Status` heading format the sweep searched for | PASS — explains the blank result, and all three are correctly `accepted` per manual read |
| Phase 3's described rule (draft+submitted lock on create, `assertFutureFrom` on create/updateDates/submit, owner-only+draft-only+entry-pruning+audit-log on `updateDates`) | `apps/api/src/routers/shift-registration.ts` lines 72-76, 217-220, 343-391 | PASS — matches exactly, including the Asia/Ho_Chi_Minh lexicographic-date-string comparison rationale in the code comment |
| Commit `54b5613` is the actual/only commit implementing this fix | `git log --oneline -- apps/api/src/routers/shift-registration.ts` | PASS |
| CLAUDE.md's bare `@AGENTS.md`/`@docs/FEATURE_INTAKE.md` import lines are untouched by Phase 2's insertion point | live file structure — imports are inside `## Harness` (lines 11-13), insertion point is after `<!-- HARNESS:END -->`, several lines away | PASS — no adjacency risk |

## Unresolved Questions

- Does any tooling in this repo actually parse/enforce the `dependencies:` frontmatter field on phase files, or is it purely documentation? If the former, finding #2's risk is lower; if the latter (most likely, based on what's visible), the inline banner fix is worth doing regardless of effort size.
- Confirm whether the post-commit/post-merge git hook that runs `npx gitnexus analyze` (referenced in both `AGENTS.md`/`CLAUDE.md` text) fully replaces content between `<!-- gitnexus:start -->`/`<!-- gitnexus:end -->` or does an in-place patch — could not read `.git/hooks/post-commit` (blocked by `.claude/.ckignore`). Low priority since Phase 2's insertion point sits outside that block either way.
