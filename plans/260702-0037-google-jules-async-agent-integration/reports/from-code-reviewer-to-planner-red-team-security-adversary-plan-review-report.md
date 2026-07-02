# Red Team / Security Adversary Review — Google Jules Async-Agent Integration Plan

Reviewer role: Fact Checker + Security Adversary
Plan: `plans/260702-0037-google-jules-async-agent-integration/`
Scope: `plan.md`, `phase-01-cleanup-dead-ci-signal.md`, `phase-02-guardrails-and-governance-docs.md`, `phase-03-validation-and-handoff.md`

---

## Finding 1: "No merge rights" guardrail cannot be technically enforced on this repo's GitHub plan

- **Severity:** Critical
- **Location:** Phase 2, section "Requirements" / "Non-functional" (line 21: *"guardrail text must be unambiguous about the two hard constraints — PRs land only in `develop`, Jules has no merge rights — since these are the actual safety mechanism"*); Phase 3, "Implementation Steps" step 5 (runbook never adds a technical control).
- **Flaw:** The plan treats "no merge rights" as a real guardrail, but the only mechanism proposed to establish it is prose in `AGENTS.md` + a decision doc. Nowhere does the plan create, or even check for, a GitHub branch-protection rule, CODEOWNERS requirement, or restricted-push rule on `develop`/`main`.
- **Failure scenario:** GitHub's REST API for this repo returns `403 {"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}` when branch protection is requested — confirmed live via `gh api repos/manhquydev/CMCnew/branches/develop/protection` and `.../main/protection`. This repo is a **private repo on a GitHub tier that does not support branch protection at all**. Any GitHub App/OAuth grant with the `pull_request: write` scope needed to open a PR is also sufficient to call the merge API on that PR (GitHub does not offer a scope that permits "open PR" but forbids "merge PR" absent branch protection or a required-review rule). So "Jules has no merge rights" is not a technical guarantee — it is a written expectation Jules has zero platform-level obligation to honor. A misbehaving agent, a Jules platform bug, or a supported-but-undocumented "auto-merge on green checks" feature (common in async coding agents) could merge directly into `develop` or even `main`, and nothing in this repo would stop it.
- **Evidence:** `gh api repos/manhquydev/CMCnew/branches/develop/protection` → `403 Upgrade to GitHub Pro`; `gh api repos/manhquydev/CMCnew/branches/main/protection` → same 403. No `CODEOWNERS` file exists in the repo (`Glob CODEOWNERS` only matches a `node_modules` vendor file). Phase 2 line 21 explicitly names this as "the actual safety mechanism" with no fallback control.
- **Suggested fix:** Before connecting Jules, either (a) upgrade to a GitHub tier that supports branch protection and add a "require pull request review before merging" rule on both `develop` and `main`, or (b) explicitly document in the decision doc that no technical control exists and the guardrail is 100% procedural/trust-based — do not claim it is "the actual safety mechanism" without one.

## Finding 2: No path/domain scoping — security-critical code stays in Jules's blast radius

- **Severity:** High
- **Location:** Phase 2, "Requirements" (label is the only scoping mechanism) and "Related Code Files" (AGENTS.md subsection: "3 guardrails: label-gated, develop-only, no merge rights").
- **Flaw:** The `jules-ok` label scopes which *issues* Jules can pick up, but nothing scopes which *files/directories* a resulting PR may touch. A "small/repetitive bug" issue can still legitimately require touching `packages/auth/src/permissions.ts` (RBAC/permission logic, currently mid-refactor per `git status` — `M packages/auth/src/permissions.ts`), RLS-relevant routers, or `apps/api/src/routers/finance.ts` / `payroll.ts`.
- **Failure scenario:** Jules's own published benchmark is SWE-bench ~51.8% (cited in the brainstorm source, `plans/reports/brainstorm-260702-0024-google-jules-async-agent-integration-report.md` line 22), notably weaker than the coding agents this repo otherwise uses. A subtle permission/RLS regression introduced while "fixing a small bug" is exactly the kind of change human PR review is worst at catching (it looks like an unrelated one-line diff, e.g. a changed guard condition), and the repo has prior, recent decisions specifically about RLS scoping mistakes (`docs/decisions/0021-curriculum-unit-global-no-rls.md`, agent-memory `project_identity-tables-global-rls.md`) — i.e., this is a real, previously-hit failure class in this codebase, not a hypothetical.
- **Evidence:** `packages/auth/src/permissions.ts` present in `git status -M` at time of review; `docs/decisions/0021-curriculum-unit-global-no-rls.md` exists and documents an RLS-scoping decision; brainstorm report line 22 cites Jules SWE-bench ~51.8%.
- **Suggested fix:** Add an explicit exclusion list to the guardrail doc/AGENTS.md subsection — e.g., issues touching `packages/auth/**`, `**/schedule.ts` RLS-relevant code, `apps/api/src/routers/finance.ts`, `payroll.ts` must never carry `jules-ok`, regardless of how small the fix looks.

## Finding 3: `develop`-target PRs bypass the repo's own integration-test safety net

- **Severity:** High
- **Location:** plan.md "Non-Goals" (line 41: defers adding a PR-level integration-test stage, "HOLD SCOPE selected"); Phase 1 "Related Code Files"/"Risk Assessment".
- **Flaw:** `Jenkinsfile:36-37` gates the `Integration tests` stage with `when { branch 'main' }` — PRs into `develop` only run `Lint + Typecheck` (`Jenkinsfile:23-34`). The plan explicitly chooses not to change this. Combined with Finding 1 (no enforced no-merge-rights) and Finding 2 (no path scoping), a Jules-authored PR that touches money/tenancy/payroll invariant code can land in `develop` having been checked only by lint+typecheck+one human, with the actual invariant tests (`apps/api/test/*.int.test.ts`, per repo convention) never executing until (and unless) that code is later merged to `main`.
- **Failure scenario:** Reviewer approves a Jules PR that "looks like a small fix" and merges to `develop`; the tenancy/payroll integration suite that would have caught a regression doesn't run until the next `main` merge, by which point the bad change may already be built on top of, or the diff context that made the bug obvious is gone.
- **Evidence:** `Jenkinsfile:36-37` (`when { branch 'main' }` comment: *"other branches get lint+typecheck as a PR gate"*); `plan.md:41` explicitly defers this with no revisit trigger tied to enabling Jules itself (only "if Jules proves valuable" per Phase 2 follow-up, i.e., after exposure already happened).
- **Suggested fix:** Either land the deferred PR-level integration-test stage before Phase 3's runbook step that actually labels a first real issue, or restrict the `jules-ok` label (via Finding 2's fix) to files with zero integration-test coverage dependency until that stage exists.

## Finding 4: Label has no access control — any collaborator can widen Jules's scope unilaterally

- **Severity:** Medium
- **Location:** Phase 2, "Implementation Steps" step 2 (label creation); Phase 3, "Implementation Steps" step 5 (runbook assumes disciplined single-issue labeling).
- **Flaw:** GitHub labels carry no per-user ACL — once `jules-ok` exists, anyone with triage/write permission on the repo can apply it to any issue, including issues the plan author never reviewed. The guardrail text specified in Phase 2 step 4 ("state the 3 guardrails ... in 3-4 lines") does not include "only X may apply this label," so the control that actually exists today (one careful person hand-picking "one small, real, low-risk issue" per the Phase 3 runbook) is a personal habit, not a written/enforced rule.
- **Failure scenario:** Today this is low risk — `gh api repos/manhquydev/CMCnew/collaborators` returns exactly one collaborator (`manhquydev`, admin). But the guardrail doc is meant to be durable ("so future agents/humans don't reopen this debate without new evidence" — plan.md line 57); it will silently stop matching reality the moment a second collaborator/contractor with triage access is added, since nothing gates who can bulk-label issues `jules-ok`.
- **Evidence:** `gh api repos/manhquydev/CMCnew/collaborators --jq '.[].login'` → `manhquydev` only. `gh label list` confirms `jules-ok` does not yet exist (no conflict), but also confirms no ACL mechanism is proposed for it.
- **Suggested fix:** Add one line to the AGENTS.md guardrail subsection: who is authorized to apply `jules-ok`, and note it must be revisited if collaborator count > 1.

## Finding 5: OAuth-scope verification step has no abort criterion

- **Severity:** Medium
- **Location:** Phase 3, "Implementation Steps" step 5, runbook bullet 2: *"Authorize the `manhquydev/CMCnew` repo via OAuth; verify granted scope is limited to this repo (not org-wide) **if the UI offers that choice**."*
- **Flaw:** This is the one point in the entire plan where the actual OAuth/App grant is checked for scope, and it is written as a soft, best-effort check with no defined fallback. If Jules's connection flow does not offer per-repo scoping (i.e., only offers "all repos this account can access"), the runbook gives the human executing it no stop/abort instruction.
- **Failure scenario:** A non-engineer (the plan's own stated audience — Phase 3 "Non-functional" requirement: *"followable by a non-engineer ... without needing another planning session"*) hits an all-or-nothing OAuth consent screen, has no written criterion for whether to proceed, and grants broader access than intended by default (the path of least resistance on a consent screen is "Authorize").
- **Evidence:** Phase 3, runbook bullet 2 quoted above; Phase 3 "Non-functional" requirement about non-engineer usability.
- **Suggested fix:** Add an explicit "if per-repo scoping is not offered, STOP and escalate — do not authorize all-repo access" instruction to the runbook.

## Finding 6: Sole reviewer is also the sole grantor — no independent check on the human gate

- **Severity:** Medium
- **Location:** Phase 2 decision doc content (step 3: *"Jules has no merge rights, human review/merge remains mandatory"*); Phase 3 runbook (single-operator process throughout).
- **Flaw:** The plan's residual safety net after Findings 1-3 is "a human reviews and merges." `gh api repos/manhquydev/CMCnew/collaborators` shows exactly one collaborator, `manhquydev` (admin). That means the same individual who decides to connect Jules, labels issues `jules-ok`, and reviews/approves every resulting PR is one person with no independent second reviewer — a single point of failure for the plan's core stated guardrail.
- **Failure scenario:** At Pro-tier volume (up to 75 tasks/day per the brainstorm report), reviewer fatigue/rubber-stamping on "small, repetitive" PRs is the realistic way this control degrades over time — not a dramatic single failure, but a gradual one the plan doesn't acknowledge or budget for (e.g., no stated review-cadence limit, no requirement to slow down if PR volume outpaces careful review).
- **Evidence:** `gh api repos/manhquydev/CMCnew/collaborators --jq '.[].login'` → single result. Brainstorm report line 20: Pro tier "75 task/ngày."
- **Suggested fix:** Cap sustained Jules PR volume relative to demonstrated reviewer bandwidth in the decision doc, or explicitly accept single-reviewer risk as a stated tradeoff (not silently absent).

---

### Verification Results (Fact Checker)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | `.github/workflows/ci.yml` exists and is a real (non-trivial) pipeline | VERIFIED | `D:\project\CMCnew\.github\workflows\ci.yml` (74 lines, full read) |
| 2 | GitHub Actions `CI / build` is FAILURE on real PRs while Jenkins posts real status (PR #11-#15) | VERIFIED | `gh pr list --json number,statusCheckRollup` — PRs 11-15 all show `"name":"build"` `"conclusion":"FAILURE"` plus `continuous-integration/jenkins/branch` SUCCESS/ERROR |
| 3 | `Jenkinsfile` integration tests run only on `main`, `develop` PRs get lint+typecheck only | VERIFIED | `Jenkinsfile:36-37` `when { branch 'main' }` on `Integration tests` stage |
| 4 | `docs/decisions/0019`, `0021` exist as format precedent | VERIFIED | `docs/decisions/0019-cicd-observability.md`, `docs/decisions/0021-curriculum-unit-global-no-rls.md` both read in full |
| 5 | Next available decision numbers are 0022/0023 (no collision) | VERIFIED | `Glob docs/decisions/00*.md` — highest existing is `0021`, no `0022`/`0023` present |
| 6 | `docs/templates/decision.md` exists | VERIFIED | `Glob` match |
| 7 | `AGENTS.md` has a "Branch workflow (bắt buộc)" section to anchor the new subsection near | VERIFIED | `AGENTS.md:3` |
| 8 | `gh label create` idempotent pattern mirrors `ck-plan`'s `--github` "ready to review" precedent | VERIFIED | `.claude/skills/ck-plan/SKILL.md:272-274` — identical `gh label list ... grep -Fx ... || gh label create` pattern |
| 9 | `harness-cli.exe intake --type ... --summary ... --lane ... --docs ...` flags match Phase 3 usage | VERIFIED | `harness-cli.exe intake --help` output matches exactly |
| 10 | GitHub branch protection is available to technically enforce "no merge rights" | **FAILED** | `gh api repos/manhquydev/CMCnew/branches/{develop,main}/protection` → `403 Upgrade to GitHub Pro or make this repository public` — feature is unavailable on this repo's current plan |

---

Status: DONE
Summary: Plan's central safety claim ("Jules has no merge rights") has no technical enforcement mechanism and the repo's GitHub plan cannot support one (branch protection API returns 403/upgrade-required, confirmed live). Combined with no file-path scoping on the `jules-ok` label and a `develop`-PR gate that skips integration tests, the three "independent guardrails" the plan claims (label + branch + no-merge) collapse to one soft control (label) plus a single human's diligence.
Concerns/Blockers: Finding 1 should block proceeding to the actual Jules connection (Phase 3 runbook) until either GitHub Pro is purchased and branch protection is configured, or the decision doc is rewritten to stop claiming "no merge rights" is an enforced guardrail.
