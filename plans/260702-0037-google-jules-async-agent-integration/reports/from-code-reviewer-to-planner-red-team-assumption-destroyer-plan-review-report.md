# Red-Team Review: Google Jules Async-Agent Integration Plan

Reviewer role: Assumption Destroyer / Contract Verifier
Plan: `plans/260702-0037-google-jules-async-agent-integration/`

## Finding 1: "No merge rights" is not a technical control on this repo — it is unverifiable vendor trust

- **Severity:** Critical
- **Location:** Phase 2, section "Requirements" (non-functional guardrail: "Jules has no merge rights"); Phase 2 decision-doc bullet "Consequences — Positive: bounded blast radius (label + branch + no-merge = 3 independent guardrails)"
- **Flaw:** The plan lists "no merge rights" as one of three *independent* guardrails, implying it's something the repo enforces. It is not. GitHub branch protection (the standard mechanism to require review/block direct merges) is unavailable on this repo's current plan tier.
- **Failure scenario:** Jules's OAuth grant (personal Google account, repo write access per the brainstorm doc) is under no obligation to stop at "open PR only" — that's a product-behavior assumption about Jules, not a GitHub-side restriction. If Jules's agent logic (or a bug in it) calls the merge API on its own PR, nothing on the GitHub side blocks it, because branch protection is not purchasable on this plan.
- **Evidence:**
  ```
  $ gh api repos/manhquydev/CMCnew/branches/develop/protection
  {"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}
  $ gh api repos/manhquydev/CMCnew --jq '{private,visibility}'
  {"private":true,"visibility":"private"}
  ```
  No `CODEOWNERS` file exists in the repo root (`Glob CODEOWNERS` only matched a vendored `node_modules` file, unrelated). Phase 2's own non-functional requirement admits the real risk in the same breath it lists the guardrail as independent: *"the actual safety mechanism (not Jules's own behavior, which cannot be verified from this repo)"* — but "no merge rights" **is** Jules's own behavior in the absence of branch protection, so the plan's framing contradicts its own stated threat model.
- **Suggested fix:** Either (a) upgrade to a GitHub tier that supports branch protection and require it as a Phase 2 success criterion (`gh api .../protection` returns a rule requiring PR review on `develop`), or (b) explicitly document in the decision doc that "no merge rights" is unenforced-by-GitHub and is solely a revocable-after-the-fact control (OAuth grant revocation), not a preventive one. As written, the decision doc overstates the guardrail's strength.

## Finding 2: Label-gating (`jules-ok`) is never verified to be a mechanism Jules actually honors

- **Severity:** Critical
- **Location:** Phase 2, "Implementation Steps" step 2 (label creation) and step 3 (decision doc: "Jules scoped to issues labeled `jules-ok`"); Phase 3 runbook step "Label one small, real, low-risk issue `jules-ok` as the first test task"
- **Flaw:** Creating a GitHub label is metadata only — it restricts nothing by itself. The plan never confirms Jules has a feature that automatically scans repo issues and self-assigns only labeled ones. The brainstorm source this plan is built on (`plans/reports/brainstorm-260702-0024-google-jules-async-agent-integration-report.md`, line 19) lists Jules's actual trigger mechanisms as: "web UI, GitHub Actions event (`google-labs-code/jules-invoke`), CLI `jules`, API alpha" — none of these describe automatic label-based issue polling.
- **Failure scenario:** If Jules only accepts tasks via manual assignment in the jules.google web UI (consistent with the cited trigger list), then `jules-ok` is a human bookkeeping convention, not a scope boundary. A human operator (or a future agent) could still hand Jules any unlabeled issue directly through the UI, and Jules would work on it — the label enforces nothing. The plan's own acceptance criteria and decision doc (Phase 2) present the label as a hard scope boundary equivalent to a branch restriction, which the evidence doesn't support.
- **Evidence:** `plans/reports/brainstorm-260702-0024-google-jules-async-agent-integration-report.md:19-20` — trigger list has no "label scan" entry; line 66 ("Tạo GitHub label `jules-ok` ... để giới hạn phạm vi issue Jules được nhận") is asserted, not sourced to any Jules product doc citation (contrast with the CI-signal claims elsewhere in the same report, which are backed by `gh pr list` evidence).
- **Suggested fix:** Before Phase 2 ships the label as a "guardrail," verify against Jules's actual product docs/UI whether label-based issue filtering is a real, configurable feature (vs. Jules always requiring manual per-task assignment). If it's manual-only, rewrite the guardrail language to say the label is an *operator checklist convention*, not an agent-enforced boundary, and add a runbook step that explicitly configures Jules (if such a setting exists) to only poll `jules-ok`-labeled issues.

## Finding 3: Hardcoded decision doc numbers 0022/0023 collide with an already-uncommitted, already-harness-recorded 0021 from a concurrent plan

- **Severity:** High
- **Location:** Phase 1, "Related Code Files" (`docs/decisions/0022-...`); Phase 2, "Related Code Files" (`docs/decisions/0023-...`); `plan.md` Dependencies section ("No other open plan touches ... `docs/decisions/` at time of writing (checked via directory scan of `plans/*/plan.md`)")
- **Flaw:** The committed state at `HEAD` only has decisions through `0020`. `docs/decisions/0021-curriculum-unit-global-no-rls.md` exists **only as an uncommitted working-tree file** — yet it is already recorded as `id=0021, status=accepted` in the harness DB (`harness-cli query decisions`). This is live proof, in this exact repo right now, that the "scan the directory for the next number" convention is racy: the number is claimed in the durable harness layer before the file is committed to git.
- **Failure scenario:** The plan's own collision check ("directory scan of `plans/*/plan.md`") would not have caught this, because 0021 isn't referenced by any `plan.md` — it's a loose file from `plans/260701-2246-curriculum-framework-oneclick-class/` (per `git status`). If that plan's work lands with 0021 renumbered, or if this Jules plan is executed from a different/fresh checkout that only sees committed history (→ next number would be computed as 0021, not 0022), Phase 1/2 could write `docs/decisions/0021-...` and collide on `harness-cli decision add --id 0021` (already taken) or silently duplicate content under different filenames pointing at the same numeric slot.
- **Evidence:**
  ```
  $ git show HEAD:docs/decisions/   # highest committed file: 0020-work-shift-manager-ownership.md
  $ git status --short docs/decisions/0021-curriculum-unit-global-no-rls.md
  ?? docs/decisions/0021-curriculum-unit-global-no-rls.md
  $ harness-cli.exe query decisions   # id=0021, "Curriculum unit global table without RLS", accepted
  ```
- **Suggested fix:** Don't hardcode decision numbers in the plan text. Add an explicit step "run `harness-cli query decisions` and `ls docs/decisions/` immediately before writing the file, take max+1" at execution time, and treat the plan's `0022`/`0023` as provisional placeholders only.

## Finding 4: Phase 1's Risk Assessment cites `docs/TOOL_REGISTRY.md` for a claim that file does not make

- **Severity:** Medium
- **Location:** Phase 1, "Risk Assessment": *"none found in scout — `docs/CK_WORKFLOW.md`, `docs/TOOL_REGISTRY.md` reference Jenkins, not Actions, as the CI provider"*
- **Flaw:** `docs/TOOL_REGISTRY.md` does not mention Jenkins, GitHub Actions, or CI at all — it's a generic inbound/outbound tool-registration doc (harness `tool register`/`tool check` mechanics). The citation is fabricated evidence used to support a "near-zero risk" conclusion.
- **Evidence:** `Grep "jenkins|Jenkins|actions|ci\.yml|workflow" docs/TOOL_REGISTRY.md` → 0 matches (file read in full, confirmed: it covers `tool register`, `tool check`, capability vocabulary — no CI-provider content anywhere). `docs/CK_WORKFLOW.md` *does* mention Jenkins/Actions (lines 189-190, 207) but the content there is itself stale (see Finding 5).
- **Suggested fix:** Remove the `docs/TOOL_REGISTRY.md` citation from the risk assessment, or replace it with an accurate source.

## Finding 5: `AGENTS.md` and `docs/CK_WORKFLOW.md` still say Jenkins is "not yet built" / GH Actions billing blocks CI — the plan edits `AGENTS.md` but never corrects this contradiction

- **Severity:** High
- **Location:** Phase 2, "Related Code Files" ("Modify: `AGENTS.md` — add a short 'Async agents (Jules)' subsection near the existing branch-workflow section")
- **Flaw:** The live `AGENTS.md` currently states: *"`ship` / `review-pr` / `vibe --ship` / `team` stay deferred until a green CI exists (GitHub Actions billing is blocked → runs fail at ~3s; Jenkins not yet built) — see `docs/CK_WORKFLOW.md` §5."* This is the exact same file the plan will edit, and this sentence directly contradicts the plan's premise (Jenkins is live and is the real CI signal, verified via PR #11-#15) and the very action Phase 1 performs (deleting the "billing-blocked" Actions workflow as if it's uncontested dead weight). `docs/CK_WORKFLOW.md` lines 189-190 and 207 repeat "Jenkins is not yet stood up" / "Jenkins not yet built."
- **Failure scenario:** A future reader (human or agent) opens `AGENTS.md`, reads the new "Async agents (Jules)" section claiming Jenkins is the trustworthy real signal, then reads three paragraphs earlier that Jenkins "is not yet built" and CI doesn't exist — and has no way to know which statement is current. Since this plan explicitly treats "real CI = Jenkins" as load-bearing for the guardrail rationale (Phase 1 Overview), leaving the contradiction unresolved undermines the very doc the plan is trying to make authoritative.
- **Evidence:** `Grep "Jenkins|GitHub Actions|billing|deferred until a green CI" AGENTS.md` → match confirmed in the file; `docs/CK_WORKFLOW.md:189-190,207` confirmed via grep.
- **Suggested fix:** Add a step to Phase 1 or 2 to update the stale `AGENTS.md`/`docs/CK_WORKFLOW.md` CI-status sentence (Jenkins is live per decision 0019/0021 precedent) in the same PR that deletes `ci.yml`, not just append new unrelated content nearby.

## Finding 6: The only automated PR gate on `develop` (where Jules lands) is lint+typecheck — no compensating control is added despite the risk being explicitly named and deferred

- **Severity:** Medium
- **Location:** `plan.md` Non-Goals ("Adding a PR-level integration-test stage to `Jenkinsfile` for `develop` branch (deferred ... HOLD SCOPE)"); Phase 3 runbook watch-list
- **Flaw:** Confirmed via `Jenkinsfile:36-41`: the `Integration tests` stage is gated `when { branch 'main' }` — PRs into `develop` get lint+typecheck only, no unit tests, no integration tests, no RLS-isolation check. The plan explicitly acknowledges this gap and defers it, relying on "human review" as the sole backstop for AI-authored PRs.
- **Failure scenario:** A Jules PR touching money/tenancy/payroll code (areas with a documented history of RLS/migration gaps in this repo — see prior decisions 0020/0021 and the `parent_account`/`student_account` global-RLS gap noted in project memory) passes lint+typecheck cleanly (typecheck doesn't catch logic/tenancy bugs) and is merged by a human reviewer who has no automated integration-test signal to lean on, only manual code reading. This is the exact class of bug (`d=2` cross-cutting tenancy/RLS regression) that integration tests exist to catch.
- **Evidence:** `Jenkinsfile:36-41` (`when { branch 'main' }` on `Integration tests` stage, comment: "other branches get lint+typecheck as a PR gate"). Phase 3 runbook's watch-list (step 5) has no item requiring the reviewer to run `pnpm --filter @cmc/api test:int` locally before merging.
- **Suggested fix:** Add one runbook line: reviewer must run the integration test suite locally (or trigger it manually in Jenkins) before merging any Jules PR that touches `apps/api`, `packages/db`, or RLS-scoped routers — a cheap compensating control that doesn't require the deferred Jenkinsfile change.

## Finding 7: No commit/PR provenance marking requirement — Jules-authored changes become indistinguishable from human commits once merged

- **Severity:** Medium
- **Location:** Phase 2 (guardrail definition); `plan.md` Acceptance Criteria ("A decision doc records the Jules governance choice ... so future agents/humans don't reopen this debate without new evidence")
- **Flaw:** `AGENTS.md:5-8` describes the real terminal flow as `develop` → PR → `main`. Once a Jules-authored commit is merged into `develop` under the "no merge rights, human review" guardrail, nothing requires it to remain identifiable (a git trailer, a required PR label surviving to the merge commit, an author email convention) as Jules-originated. The `jules-ok` issue label doesn't propagate to the PR or merge commit by default.
- **Failure scenario:** Six months later, someone investigating a `develop`→`main` regression has no fast way to `git log --author` or `git log --grep` filter for "which commits came from the async agent" — undermining the plan's own stated goal of leaving "a written decision record for whoever reviews this later."
- **Evidence:** `AGENTS.md:5-8` (branch flow); no mention of PR-title/commit-trailer convention anywhere in Phase 2 or Phase 3 implementation steps.
- **Suggested fix:** Require Jules PRs to carry a fixed title prefix or label (e.g., `[jules]`) that Phase 3's runbook instructs the operator to preserve through merge, or a required `Co-authored-by:` / trailer convention.

---

### Verification Results (Contract Verifier)

| Claim in plan | Check performed | Result |
|---|---|---|
| `.github/workflows/ci.yml` exists and is a real (if broken) pipeline | `Read .github/workflows/ci.yml` | VERIFIED — file exists, defines a real pipeline (typecheck, unit, integration, RLS verify, build) triggered on `push:[main]` and `pull_request:` (all branches) |
| `docs/templates/decision.md` structure (Context/Decision/Alternatives/Consequences/Follow-up) | `Read docs/templates/decision.md` | VERIFIED — matches exactly what Phase 1/2 plan to write |
| Next available decision doc number is 0022/0023 | `git show HEAD:docs/decisions/`, `git status`, `harness-cli.exe query decisions` | FAILED — HEAD only has through 0020; `0021` exists uncommitted and is already recorded in harness DB, contradicting the plan's dependency-scan claim (see Finding 3) |
| `harness-cli.exe decision add` flags | `harness-cli.exe decision add --help` | VERIFIED — accepts `--id`, `--title`, `--status`, `--doc`, `--verify`, `--predicted`, `--notes`; plan's hedge ("check --help first") is appropriate and sufficient |
| `harness-cli.exe intake` flags used in Phase 3 (`--type`, `--summary`, `--lane`, `--docs`) | `harness-cli.exe intake --help` | VERIFIED — matches exactly, including accepted lane values |
| `gh label list ... || gh label create ...` idempotent pattern (Phase 2 step 2) | `Grep` across `.claude/skills` for the same pattern | VERIFIED — identical pattern already used by `ck-plan` (`ready to review`) and `vibe` skills; not a novel/unverified construct |
| "no merge rights" guardrail is enforceable on GitHub | `gh api repos/manhquydev/CMCnew/branches/develop/protection`, `gh api repos/manhquydev/CMCnew --jq '{private,visibility}'` | FAILED — 403, branch protection unavailable on current plan tier for this private repo; no `CODEOWNERS` in repo root either (see Finding 1) |
| `docs/CK_WORKFLOW.md`/`docs/TOOL_REGISTRY.md` "reference Jenkins, not Actions, as CI provider" (Phase 1 risk assessment) | `Grep "jenkins\|actions\|ci\.yml"` in both files | PARTIAL FAIL — `docs/CK_WORKFLOW.md` does mention Jenkins (but stale: "not yet stood up"); `docs/TOOL_REGISTRY.md` mentions neither (see Findings 4, 5) |
| `AGENTS.md` "Branch workflow" section location for the new subsection | `Read AGENTS.md` lines 1-25 | VERIFIED — section exists as described, but contains stale CI-status text the plan doesn't touch (see Finding 5) |
| Jenkins runs integration tests on PRs into `develop` | `Read Jenkinsfile` | FAILED (contradicts implicit plan assumption of adequate PR coverage) — integration tests are `when { branch 'main' }` only; `develop` PRs get lint+typecheck only (see Finding 6) |
| Jules supports GitHub-label-based issue scoping as an enforced mechanism | `Read plans/reports/brainstorm-260702-0024-...-report.md` | UNVERIFIED — brainstorm source never cites a Jules product doc confirming label-based auto-scoping; documented triggers (web UI, GH Actions event, CLI, API) don't include it (see Finding 2) |
| No other open plan touches `docs/decisions/` | `Grep` decision-doc references across `plans/260701-2246-...` and `plans/260701-2344-...` | FAILED as stated — no *plan.md* references it, but an uncommitted file from `plans/260701-2246-curriculum-framework-oneclick-class` already occupies the numeric slot immediately before the plan's chosen range (see Finding 3) |

Status: DONE_WITH_CONCERNS
Summary: Verified the plan's tooling/CLI contracts (harness-cli, gh label pattern, decision template) are accurate, but found two Critical trust-boundary gaps — "no merge rights" is not GitHub-enforceable on this repo tier, and label-gating is never confirmed to be a real Jules capability — plus a live, evidence-backed decision-numbering collision risk and a stale-doc contradiction in the exact file Phase 2 edits.
Concerns/Blockers: Findings 1 and 2 are Critical and go to the core premise ("guardrails" that don't actually guard) — recommend the planner resolve these before Phase 2 implementation, not just note them as residual risk in the decision doc.
