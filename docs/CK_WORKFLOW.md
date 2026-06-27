# ClaudeKit Workflow (ck × Harness)

Status: Adopted — see decision `0009-ck-workflow-adoption`. Wired into `AGENTS.md`.

This document maps **ClaudeKit (ck)** onto this project's **Harness** so that when a
human passes a request, the harness-driven agent knows *which ck capability to use,
in which phase, at which risk lane* — to get the best result without breaking the
governance the Harness already enforces.

Mental model in one line:

> **Harness answers WHEN / WHAT-to-prove / governance. ClaudeKit answers HOW / who-does-it.**
> ck plugs *into* the Harness Task Loop; it does not replace it.

The Harness durable layer (`scripts/bin/harness-cli`, `harness.db`) stays the single
source of truth for intake, stories, decisions, traces, and backlog. ck supplies the
execution muscle and quality gates. Where they overlap, the Harness wins on
*governance*, ck wins on *execution quality*.

---

## 1. ClaudeKit as a company (role decomposition)

ck = ~50 skills/commands + a set of dev subagents. Read as an org chart:

| Department | ck "employees" (skill / agent) | Primary commands |
| --- | --- | --- |
| **R&D / Thinking** | `ask` (consulting architect, read-only), `brainstorm` (principal-engineer advisor), `research` + `researcher` (tech-intel analyst), `planner` (tech lead) | `/ck:ask`, `/ck:brainstorm`, `/ck:research`, `/ck:plan` |
| **Risk / QA strategy** | `ck-scenario` (edge-case decomposer, 12 dimensions) | `/ck:scenario` |
| **Recon** | `scout` + `Explore` (parallel codebase recon) | `/ck:scout` |
| **Build** | `cook` + `fullstack-developer` (senior implementer) | `/ck:cook` |
| **Incident / bug fix** | `fix` (remediation), `ck-debug` + `debugger` (diagnosis-only SRE) | `/ck:fix`, `/ck:debug` |
| **Quality gate** | `ck-code-review` + `code-reviewer` (staff-engineer reviewer), `tester` | `/ck:code-review`, `/ck:test` |
| **Security** | `ck-security` (STRIDE+OWASP, red-team) | `/ck:security` |
| **Docs / knowledge** | `docs` + `docs-manager`, `journal`, `watzup` | `/ck:docs`, `/ck:journal`, `/ck:watzup` |
| **Release / Git** | `git-manager`, `ship`, `review-pr`, `worktree` | `/ck:git`, `/ck:ship`, `/ck:review-pr`, `/ck:worktree` |
| **PM / orchestration** | `project-management` + `project-manager`, `team`, `vibe`, `flow` | `/ck:team`, `/ck:vibe`, `/flow` |

### Role contracts worth remembering

- **Read-only roles** (never edit code): `ask`, `research`/`researcher`, `code-reviewer`,
  `git-manager`, `watzup`, `scout`. Use them freely without fear of mutation.
- **Plan-only roles** (no implementation): `brainstorm`, `plan`/`planner`, `docs`.
  All three carry a HARD-GATE "do not implement".
- **Diagnosis-only**: `debug`/`debugger` proves root cause and stops; `fix` is the one
  that carries through implement → verify → prevent.
- **Build roles** with strict file-ownership: `fullstack-developer`.

---

## 2. ClaudeKit mechanics that matter for integration

These are the real behaviors (extracted from the ck skill internals), not marketing:

1. **The canonical chain**: `brainstorm → plan → /clear → cook @plan.md → test → code-review → git`.
   `/clear` between `plan` and `cook` is a *context-hygiene* step — start `cook` with a
   fresh window pointed at the plan file. Compatible with our `CONTEXT_RULES.md` budgets.

2. **Plan modes scale with blast radius** — they map 1:1 to Harness lanes:

   | ck plan mode | Behavior | Harness lane |
   | --- | --- | --- |
   | `--fast` | no research, no red-team, no validate | tiny |
   | *(default)* / `--hard` | research + red-team | normal |
   | `--deep` | per-phase scout + red-team + **validate** | high-risk |
   | `--two` | two competing approaches, then gate | high-risk (architecture choice) |
   | `--parallel` | parallel-executable phases | normal/high-risk w/ independent modules |
   | `--tdd` *(composable)* | tests-first per phase | any refactor / critical logic |

3. **Execution hard-gates (reinforce, don't fight, our Done Definition):**
   - `cook` & `fix`: **scout-first**, **exact-requirements / exact-root-cause**, and
     **NO-SIDE-EFFECTS** (5 proofs) before "done".
   - `fix`: **3+ failed attempts → STOP and question architecture** (don't thrash).
   - `code-review`: **Iron Law — no completion claim without fresh verification evidence**;
     spec-compliance stage must pass before quality stage.
   - `test`: never mask failing tests to go green.

4. **Orchestration tiers** (most → least gated):
   - `/flow` — contract-first, per-stage *mechanical + semantic* gates, honors "kill".
     Stages: `Idea → Research → Scope → PRD → ADR → Contract → Cards → Build → Review → Deploy → Verify-live → Retro`. Security-class work HALTs for written operator acceptance.
   - `/ck:vibe` — single-session issue→plan→cook/fix→review→ship→PR→(merge+CI).
   - `/ck:team` — true multi-session parallel teammates (needs
     `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, CLI-only, Opus, worktree isolation).

5. **ck guard-rails are mostly advisory** (only hooks with `exit 2` truly block). Our
   Harness durable layer + intake lanes are *stronger* governance — so we treat ck
   guard-rails as quality reminders and keep the Harness CLI as the enforcement record.

> **Two name collisions to know:** the real planner is `skills/ck-plan/` (v1.1.0), not the
> thin `skills/plan/` router. The real reviewer is `skills/ck-code-review/` (v2.0.0), not
> the legacy `skills/code-review/`. Prefer the engine versions.

---

## 3. The integration: ck routed through the Harness Task Loop

The Harness Task Loop (`HARNESS.md`) is unchanged. ck slots into each phase. Read this
table top-to-bottom for a task; pick the column for your lane.

| Harness phase | tiny | normal | high-risk |
| --- | --- | --- | --- |
| **Intake** (classify + record) | `harness-cli intake`; `/ck:scout` only if unfamiliar area | `harness-cli intake`; `/ck:scout`; `/ck:ask` for a quick design question | `harness-cli intake`; `/ck:scout`; `/ck:research` for external unknowns |
| **Planning** | usually none (patch directly); `/ck:ask` if unsure | `/ck:brainstorm` (if approach unclear) → `/ck:plan --hard` (+`--tdd` if refactor) → `harness-cli story add` | `/ck:brainstorm` → `/ck:plan --deep` or `--two` (+`--tdd`) → `/ck:scenario --focus authorization|security`; create `high-risk-story/*` + draft decision |
| **Implementation** | direct edit; `/ck:fix --quick` for trivial bug | `/ck:cook @plan.md` (feature) or `/ck:fix` (defect) | `/ck:worktree` (isolate) → `/ck:cook @plan.md` **interactive, NOT --auto** (high-risk stops for approval by design) |
| **Validation** | quick check; `/ck:test` if logic changed | `/ck:test` + `/ck:code-review --pending` → `harness-cli story update` proof | full `/ck:test` + `/ck:code-review --pending` + `/ck:security` (if auth/data/external) + `/ck:scenario --saturation`; write `validation-report.md`; `harness-cli story verify` |
| **Trace / close** | `harness-cli trace` | `/ck:watzup` → `harness-cli trace`; `/ck:journal` | `/ck:watzup` → `harness-cli trace`; `/ck:journal`; `harness-cli decision add` |
| **Friction** | — | `harness-cli backlog add` if repeated pain | `harness-cli backlog add` + `harness-cli intervention add` when corrected |

**Lane → ck plan-mode quick rule:** tiny = `--fast`/none · normal = default or `--hard` · high-risk = `--deep` or `--two`. Add `--tdd` whenever existing behavior must be preserved.

**Hard-gate respect:** any task hitting a Harness *hard gate* (auth, authorization, data
loss/migration, audit/security, external provider, weakening validation) is **high-risk**
— use the high-risk column and pause for human confirmation if direction is ambiguous,
exactly as `FEATURE_INTAKE.md` requires.

---

## 4. End-to-end examples

**Tiny — fix a label typo / copy edit**
```
harness-cli intake --type "change request" --summary "fix label" --lane tiny
# edit file directly
harness-cli trace --summary "label fix" --outcome success
```

**Normal — new feature with a story**
```
harness-cli intake --type "spec slice" --summary "<feature>" --lane normal
/ck:brainstorm "<feature>"          # if approach unclear; produces design report
/ck:plan --hard --tdd "<feature>"   # phased plan + research + red-team
harness-cli story add --id US-0XX --title "<feature>" --lane normal --verify "<cmd>"
/clear
/ck:cook @plans/<dir>/plan.md       # scout-first, no-side-effects gate, mandatory review
/ck:test
/ck:code-review --pending
harness-cli story update --id US-0XX --unit 1 --integration 1
/ck:watzup
harness-cli trace --story US-0XX --summary "<what changed>" --outcome success
/ck:journal
```

**High-risk — touches auth / payroll / data model**
```
harness-cli intake --type "change request" --summary "<x>" --lane high-risk
/ck:research "<external unknowns>"           # if any
/ck:brainstorm "<x>"
/ck:plan --deep --tdd "<x>"                  # deep auto-runs validate + red-team
/ck:scenario --focus authorization "<x>"     # risk rows into the plan
# create docs/stories/.../execplan.md + overview/design/validation from high-risk template
# draft docs/decisions/NNNN-<x>.md
/ck:worktree "<x>"
/clear
/ck:cook @plans/<dir>/plan.md                # interactive (no --auto)
/ck:test
/ck:code-review --pending
/ck:security <scope>                         # STRIDE+OWASP; --red-team if warranted
harness-cli story verify <id>
harness-cli decision add --id NNNN-<x> --title "<x>" --doc docs/decisions/NNNN-<x>.md
harness-cli trace --story <id> --summary "<x>" --outcome success
/ck:journal
```

---

## 5. Adoption depth (recommended for CMCnew right now)

Tuned to current reality: **solo build, CI/CD on Jenkins deferred, merge → `main` paused
(PR #1), branch rule `develop`/feature → PR-only.**

- **Tier 1 — adopt now (the core working set):**
  `scout`, `ask`, `brainstorm`, `research`, `plan`, `scenario`, `cook`, `fix`, `debug`,
  `test`, `code-review`, `security`, `docs`, `journal`, `watzup`, `git`, `worktree`,
  `project-management`. These are local, advisory, and reinforce the Harness.

- **Tier 2 — use selectively:** `ck-security --red-team` / `--fix` (before auth/payment/data
  releases), `scenario --saturation` (pre-release coverage audit). Higher token cost.

- **Tier 3 — defer until a green CI exists:** `ship` (auto-build → PR), `review-pr --fix --reply`
  (needs GitHub CI green to converge), `vibe --ship` (auto-merge), `team` (needs
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, multi-session, Opus — overkill for solo). These
  need a green CI to converge; GitHub Actions runs currently fail at ~3s (billing blocked) and
  Jenkins is not yet stood up, so no green CI exists to gate auto-merge yet. (PRs #1/#2 already
  merged to `main`; the earlier merge pause was lifted.)

**Git boundary (non-negotiable, from `AGENTS.md`):** never let a ck build skill auto-commit
to `main`. Keep commits on `develop`/feature; `/ck:cook` and `/ck:fix` finalize steps may
commit via `git-manager` **only on the working branch**. PR → `main` stays human-reviewed.

---

## 6. Guard-rail reconciliation (no double-governance)

| Concern | Owner | Note |
| --- | --- | --- |
| Risk classification & lane | **Harness** (`FEATURE_INTAKE.md`) | ck plan-mode is *derived* from the lane, not a second classifier |
| Durable record of work | **Harness** (`harness-cli` intake/story/trace/decision) | ck journals/reports are evidence, not the record of truth |
| Execution quality gates | **ck** (scout-first, no-side-effects, verification iron law, spec-compliance) | These satisfy parts of the Harness Done Definition — run them, then record the proof in the durable layer |
| Context budget | **Harness** (`CONTEXT_RULES.md`) | ck `/clear`-between-phases aligns with this |
| Branch / release policy | **Harness/`AGENTS.md`** | ck `ship`/`vibe`/`review-pr` deferred until a green CI exists (GH Actions billing blocked; Jenkins not yet built) |

Rule of thumb: **run ck for the doing, record the Harness for the proving.** Never skip
`harness-cli trace` just because a ck skill wrote a journal entry.

---

## 7. How to wire this in (proposed — pending approval)

Two additive, reversible steps (done in decision `0009-ck-workflow-adoption`):

1. Add a short "ClaudeKit usage" section to `AGENTS.md` (always-loaded), placed
   outside the `HARNESS:BEGIN/END` machine-managed block: the routing rule + a link
   to this file, so every session auto-knows ck routes through the Harness via
   Section 3's table.
2. Record a durable decision:
   `harness-cli decision add --id 0009-ck-workflow-adoption --title "ClaudeKit workflow adoption" --doc docs/decisions/0009-ck-workflow-adoption.md`.

**Not done — and why:**

- **No `harness-cli tool register` for ck.** The inbound tool registry
  (`docs/TOOL_REGISTRY.md`) is for *optional, probed* capability providers (linters,
  deploy checks, gitnexus) that the Harness checks for presence. ck is the agent's
  own execution layer, not a probed inbound tool — registering it is the wrong
  abstraction and would fail the `cli` presence probe.
- **No new hook.** A `UserPromptSubmit` injector could auto-surface Section 3 but
  risks colliding with existing ck hooks; treat as a separate, later decision.
- **ELI5 output style is intentional.** `.claude/.ck.json` sets `codingLevel: 0`
  (ClaudeKit's "explain-from-zero" mode). It is an operator preference — leave it.

---

## Open questions

1. Confirm Tier-3 deferral is right, or do you want `ship`/`review-pr` enabled now in
   "PR-only, no auto-merge" mode (they *can* stop at PR creation without merging)?
2. After Jenkins CI lands, do we want `/ck:vibe` as the default issue→PR runner?
3. Should `team` be considered at all later (multi-session, Opus, experimental flag), or
   is the solo + subagent model sufficient for this project?
