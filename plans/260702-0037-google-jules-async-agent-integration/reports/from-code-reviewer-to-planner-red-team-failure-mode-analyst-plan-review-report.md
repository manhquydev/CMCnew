# Red Team / Failure Mode Review — Google Jules Async-Agent Integration Plan

Reviewer: code-reviewer (Failure Mode Analyst posture)
Plan: `plans/260702-0037-google-jules-async-agent-integration/`

## Finding 1: "No merge rights" / "develop-only" guardrails are unenforceable on this repo

- **Severity:** Critical
- **Location:** Phase 2, section "Requirements" / "Risk Assessment"; Phase 3, runbook step "confirm Jules did not attempt to merge it"
- **Flaw:** The plan's entire safety model rests on two "hard constraints" — PRs land only in `develop`, Jules has no merge rights — enforced, per Phase 2, purely as text in `AGENTS.md` and a decision doc. Nothing in the plan checks whether GitHub can technically enforce either constraint on this repo.
- **Failure scenario:** GitHub branch protection (required reviews, restrict-who-can-push, restrict-who-can-merge) is the only mechanism that could make "no merge rights" or "develop-only" a real guardrail rather than a convention Jules is expected to read and honor. This repo is **private** and **not on a paid plan that supports branch protection**: `gh api repos/manhquydev/CMCnew/branches/main/protection` and the same call for `develop` both return `403 {"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."}`. There is exactly one collaborator (`manhquydev`, admin/push/maintain) — no protection rules exist to restrict anyone with write access, including an OAuth app, from pushing directly to `main` or merging a PR with zero reviews. If Jules's GitHub OAuth grant includes standard repo write scope (required just to open PRs), nothing on GitHub's side stops it from pushing to `main` or clicking merge — the plan's "3 independent guardrails" claim (Phase 2 decision doc bullet) is actually 1 technical control (the label, which only gates what Jules is *told* to look at) and 2 unenforced conventions.
- **Evidence:** `gh api repos/manhquydev/CMCnew --jq '{private}'` → `{"private":true}`; `gh api repos/manhquydev/CMCnew/branches/main/protection` → HTTP 403 Pro-required; `gh api repos/manhquydev/CMCnew/collaborators` → single admin collaborator, no team/role scoping present.
- **Suggested fix:** Either (a) explicitly document in decision 0023 that "no merge rights" and "develop-only" are *social/documentation* controls only, not GitHub-enforced, and size the residual risk accordingly (this is a materially different risk profile than "3 guardrails"), or (b) add a real technical control before connecting Jules — e.g., grant the OAuth app/GitHub App install scoped to `develop` only via fine-grained PAT/App permissions (contents: write, no admin), since branch protection is unavailable at this plan tier.

## Finding 2: Phase 1's scout evidence for "near-zero risk" is factually wrong

- **Severity:** High
- **Location:** Phase 1, section "Risk Assessment"
- **Flaw:** Risk Assessment states: "none found in scout — `docs/CK_WORKFLOW.md`, `docs/TOOL_REGISTRY.md` reference Jenkins, not Actions, as the CI provider." This is used as the sole justification for calling the deletion "near-zero risk."
- **Failure scenario:** `docs/TOOL_REGISTRY.md` contains **zero** occurrences of "Jenkins," "Actions," "CI," or "provider" in a CI-relevant context (grep for `Jenkins|Actions|CI / build|continuous-integration` returns no matches at all). The claim that this file references Jenkins as the CI provider is invented, not observed. Separately, `docs/CK_WORKFLOW.md` lines 189 and 207 still say "Jenkins is not yet stood up" / "Jenkins not yet built" — which is itself stale (decision 0019, dated 2026-06-30, and this very plan's own verified `gh pr list` evidence confirm Jenkins has been live and posting real status since 2026-06-30). The plan is citing a doc it acknowledges elsewhere is stale as corroborating evidence, and citing a second doc that says nothing on the topic. This means the "scout" step that grounds the phase's risk rating was not actually performed as described.
- **Evidence:** `Grep pattern:"Jenkins|Actions|CI / build|continuous-integration" path:docs/TOOL_REGISTRY.md` → no matches. `docs/CK_WORKFLOW.md:189` "Jenkins is not yet stood up"; `docs/CK_WORKFLOW.md:207` "Jenkins not yet built."
- **Suggested fix:** Re-run the scout for real before executing Phase 1: grep the full `docs/` tree and `.claude/skills/` for any hardcoded dependency on the Actions check name (`CI / build`, `workflow_run`, `actions/checkout`, etc.), and flag `docs/CK_WORKFLOW.md` for a stale-Jenkins-status correction while in this area.

## Finding 3: "Develop-only" guardrail has zero real-world precedent in this repo's actual PR flow

- **Severity:** High
- **Location:** Phase 2, "Requirements" (non-functional: "PRs land only in `develop`"); Phase 3, runbook
- **Flaw:** The plan assumes a develop-target PR is a normal, reviewable event in this repo's workflow. It is not, per both `AGENTS.md` and live PR history.
- **Failure scenario:** `gh repo view --json` shows `default_branch: "main"`. `gh pr list --state all --json baseRefName --limit 15` shows **all 15** of the repo's PRs to date (#1–#15) target `baseRefName: "main"` — none target `develop`. `AGENTS.md:5-6` confirms the real workflow is: work directly on `develop`, then PR `develop → main`; there is no described or observed pattern of feature branches PR'ing into `develop`. A Jules PR that targets `develop` is therefore an entirely novel event type nobody currently has a review habit around — no existing branch-protection-equivalent process, no CI gate proven to run against that PR shape (Jenkinsfile behavior for a `develop`-target PR is unverified by this plan), and no human reviewer muscle memory for "check this PR before it lands." Combined with Finding 1 (no branch protection possible), a Jules PR into `develop` could sit un-reviewed indefinitely, or a distracted human could merge it out of habit (most PRs they've ever merged went to `main`).
- **Evidence:** `gh repo view manhquydev/CMCnew --json visibility,isPrivate` and `gh pr list --state all --json number,baseRefName --limit 5` → all `baseRefName: "main"`; `AGENTS.md:5-6`.
- **Suggested fix:** Add a Phase 3 verification step that specifically confirms Jenkins actually runs and posts a real check on a `develop`-target PR (not assumed from `main`-target PR history), and add an explicit reviewer-habit note to the runbook: "this is the first PR type in this repo that targets develop — do not apply your usual main-PR review reflexes."

## Finding 4: Sole remaining CI signal (Jenkins) is not reliably green — no fallback after Actions removal

- **Severity:** Medium
- **Location:** Phase 1, "Overview" / "Requirements" (non-functional: "the real Jenkins signal... must be completely untouched")
- **Flaw:** The plan treats Jenkins as the dependable "real" signal to leave standing once Actions noise is removed, but doesn't examine Jenkins's own reliability, which matters once Jenkins becomes the *only* signal Jules reads.
- **Failure scenario:** Of the 5 most recent real PRs, `continuous-integration/jenkins/branch` shows `ERROR` (not just `FAILURE` — an error state, consistent with webhook/infra flake) on PR #11 and #13 — a 40% error rate in the sampled window. Today two checks exist so a human/agent has a fallback signal even when Jenkins errors; after Phase 1, if Jenkins errors on a Jules PR, there is **no** working CI signal at all. The plan never specifies what Jules is expected to do when its sole status source is in `ERROR` (not pending, not failing — erroring), which is exactly the ambiguous state most likely to make a status-reading loop misbehave (the scenario the plan explicitly says it wants to prevent).
- **Evidence:** `gh pr list --state all --json number,statusCheckRollup --limit 15` → PR #11 and #13 show `{"name":"continuous-integration/jenkins/branch","state":"ERROR"}`.
- **Suggested fix:** Add a Phase 3 check confirming Jenkins's error rate/flakiness on `develop`-target PRs specifically, and document in the runbook what "unassign if it loops" means when the trigger is a Jenkins infra error rather than a real code failure — the human is unlikely to be watching (that's the stated use case).

## Finding 5: No rollback path is defined for Phase 1's deletion

- **Severity:** High
- **Location:** Phase 1, "Risk Assessment"; plan.md "Acceptance Criteria"
- **Flaw:** Risk Assessment calls the deletion "near-zero risk" partly because it's asserted to be reversible, but no phase states how to reverse it, nor a concrete trigger for when reversal is warranted.
- **Failure scenario:** If Phase 3 verification (opening a real PR) reveals something unexpectedly depended on the Actions check existing — e.g., a third-party bot (CodeRabbit, `cubic · AI code reviewer`, both observed live on PR #11-#15) that gates its own behavior on seeing a `build` check context, or a human reviewer's local `gh pr checks` script that assumes 2 checks — the plan has no documented "revert this specific deletion" step. Phase 1 step 2's decision-doc follow-up only covers a *different* scenario (re-adding Actions later if billing is fixed, "not blindly restore this one"), which actively argues against a fast rollback of the file as-was. There is no `git revert <sha>` note, no owner, no time-box for confirming the deletion was safe before it becomes hard to distinguish "safe cleanup" from "recently caused a regression."
- **Evidence:** Phase 1 file, "Risk Assessment" section (lines 55-61) — asserts reversibility but the only remediation language present (step 2, "Follow-up") explicitly discourages restoring the original file.
- **Suggested fix:** Add an explicit rollback note to Phase 1: "if Phase 3 verification surfaces an unexpected dependency, `git revert` the deletion commit directly (do not hand-roll a new workflow) and re-open decision 0022 with status `Superseded`."

## Finding 6: Decision-doc numbering has no execution-time collision check, despite high recent velocity

- **Severity:** Medium
- **Location:** Phase 1 step 2 / Phase 2 step 3 (hardcoded `0022`, `0023` filenames chosen at plan-write time)
- **Flaw:** The plan hardcodes `docs/decisions/0022-...md` and `0023-...md` based on `0021` being the latest number at plan-authoring time, with no re-check-before-write step in the implementation steps.
- **Failure scenario:** Decision numbers `0019`, `0020`, `0021` were created on three consecutive days (`2026-06-30`, `2026-07-01`, `2026-07-02` — confirmed via `Date:` headers), i.e. roughly one new decision doc per day in this repo right now. Since `plans/*/plan.md` scan (Dependencies section) found no *other current plan* claiming `0022`/`0023` explicitly, there's no known collision today — but the plan's own implementation steps don't re-glob `docs/decisions/` immediately before writing, so if any other concurrent session (this plan's Dependencies check is a point-in-time scan, not a lock) lands a decision doc first, Phase 1/2 would silently overwrite or number-collide with it.
- **Evidence:** `grep -m1 "^Date:" docs/decisions/0019-*.md docs/decisions/0020-*.md docs/decisions/0021-*.md` → `2026-06-30`, `2026-07-01`, `2026-07-02`.
- **Suggested fix:** Add "re-run `Glob docs/decisions/00*.md` immediately before writing the new file to confirm the number is still free" as an explicit step in both Phase 1 step 2 and Phase 2 step 3.

## Finding 7: Runbook safety net depends on human vigilance, which contradicts the plan's own stated purpose

- **Severity:** Critical
- **Location:** Phase 3, runbook step "If Jules loops or times out repeatedly on the same issue, unassign/unlabel and escalate manually"
- **Flaw:** Combined with Finding 1 (no branch protection possible) and Finding 3 (no develop-PR review habit), the only backstop against a misbehaving Jules run is a human noticing and intervening manually — but the plan's own Overview states the entire point of Jules is unattended operation ("auto-fix small/repetitive bugs while the operator is away").
- **Failure scenario:** There is no repo-side technical circuit breaker: no branch protection to block a bad merge, no automated quota/task-count monitor, no alerting if Jules opens repeated PRs against the same issue. If the human is in fact away (the explicit use case), a stuck/looping Jules can push multiple broken commits or PRs with nothing in the repo stopping a subsequent accidental or automatic merge, and no one will see the "unassign if it loops" signal in time to act on it. The runbook's mitigation is written as an instruction to the human, not a system control — it fails exactly when the system is used as designed (operator absent).
- **Evidence:** Phase 3 runbook bullet list (no monitoring/alerting step); cross-referenced with Finding 1's branch-protection-unavailable evidence.
- **Suggested fix:** Before connecting a live account, add a minimal technical backstop scoped to this plan's spirit (e.g., a scheduled check — cron/GitHub Action-free, since Actions is being removed — that flags open PRs from the Jules-associated actor older than N hours, or a Jenkins post-build Slack/webhook alert on new `develop`-target PRs) rather than relying solely on the human reading the runbook correctly and checking in unprompted.

---

### Verification Results (Fact Checker)

| # | Claim | Result |
|---|-------|--------|
| 1 | `.github/workflows/ci.yml` exists, billing-blocked-style pipeline (Postgres service, pnpm, Node 22) | VERIFIED (`.github/workflows/ci.yml:1-46`) |
| 2 | Jenkins (`continuous-integration/jenkins/branch`) posts real status on PR #11-#15, alongside Actions `build` (always FAILURE) | VERIFIED (`gh pr list --json statusCheckRollup` output for #11-#15) |
| 3 | `docs/CK_WORKFLOW.md`/`docs/TOOL_REGISTRY.md` "reference Jenkins, not Actions, as the CI provider" (Phase 1 Risk Assessment) | FAILED — `docs/TOOL_REGISTRY.md` has zero matches for Jenkins/Actions/CI; `docs/CK_WORKFLOW.md:189,207` says Jenkins "not yet stood up/built" (stale, contradicts plan's own premise) |
| 4 | `docs/decisions/0022-*.md` and `0023-*.md` are free (no existing files) | VERIFIED (`Glob docs/decisions/00*.md` — latest is `0021-curriculum-unit-global-no-rls.md`) |
| 5 | No other open plan claims decision numbers 0022/0023, or edits `.github/workflows/`/`AGENTS.md`/`docs/decisions/` | VERIFIED for filename/number collision (grep across `plans/`); UNVERIFIED as a hard guarantee since no lock mechanism exists (see Finding 6) |
| 6 | `AGENTS.md` has a "Branch workflow (bắt buộc)" section to anchor the new "Async agents (Jules)" subsection near | VERIFIED (`AGENTS.md:3`) |
| 7 | `harness-cli.exe decision add` / `intake` flags match plan usage (`--id`, `--title`, `--doc`; `--type`, `--summary`, `--lane`, `--docs`) | VERIFIED (`harness-cli.exe decision add --help`, `harness-cli.exe intake --help`) |
| 8 | `docs/templates/decision.md` exists for the two new decision docs to follow | VERIFIED (`Glob docs/templates/decision.md`) |
| 9 | Label-creation idempotent pattern "matches the pattern already used by `ck-plan`'s `--github` mode for `ready to review`" | VERIFIED (`.claude/skills/ck-plan/SKILL.md:272-273`, near-identical `gh label list ... || gh label create ...` idiom) |
| 10 | Branch protection can gate/enforce "develop-only, no merge rights" on `main`/`develop` for this repo | FAILED — `gh api repos/manhquydev/CMCnew/branches/{main,develop}/protection` → HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature" (repo confirmed private via `gh api repos/manhquydev/CMCnew --jq '{private}'`) |

### Unresolved Questions

- Does the intended Jules GitHub OAuth/App grant support scoping write access to a single branch (`develop`) at the App-permission level, given branch protection is unavailable on this repo tier? This determines whether Finding 1's residual risk is closeable at all without upgrading to GitHub Pro/Team.
- Has anyone confirmed Jenkins actually triggers and posts a check on a PR whose base branch is `develop` (all historical evidence is from `main`-target PRs)? Finding 3.

Status: DONE
Summary: 7 evidence-backed findings; most severe is that GitHub branch protection is unavailable on this private repo (403 Pro-required), making the plan's core "develop-only / no merge rights" guardrails unenforced conventions rather than technical controls — this is not surfaced anywhere in the plan's risk assessments.
