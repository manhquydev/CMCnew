# Session Loop (Brownfield ck × Harness)

Status: Adopted — see decision `0017-daily-session-loop-playbook`.

A repeatable **daily working loop** for CMCnew: an existing (brownfield) codebase
worked solo with ClaudeKit (ck) inside the Harness Task Loop. This is the
operational "how I run a session" layer. It does **not** replace governance:

- **Risk lane + ck capability per phase** → `docs/CK_WORKFLOW.md` §3 (phase × lane table).
- **Durable Task Loop + Done Definition** → `docs/HARNESS.md` §Task Loop.
- **Intake classification** → `docs/FEATURE_INTAKE.md`.

This file ties those three together into the actual sequence of commands a session runs.

> Windows: the CLI is `.\scripts\bin\harness-cli.exe`. POSIX paths shown below use
> `scripts/bin/harness-cli`; substitute the `.exe` form on this machine.

---

## The loop at a glance

```text
OPEN ──▶ LOAD CONTEXT ──▶ INTAKE ──▶ ┌─ PER-TASK LOOP ─┐ ──▶ WRAP-UP ──▶ CLOSE
                                     │ plan → /clear   │
                                     │ → cook/fix      │
                                     │ → test → review │
                                     │ → trace         │
                                     └── repeat ───────┘
```

The per-task loop is the Harness Task Loop (HARNESS.md steps 1–9) expressed as ck commands.
Run it once per work item; run the OPEN/CLOSE bookends once per session.

---

## 0. OPEN — confirm you are safe to work

```bash
git rev-parse --abbrev-ref HEAD          # MUST NOT be main (AGENTS.md branch rule)
.\scripts\bin\harness-cli.exe query matrix   # behavior→proof control panel
```

- If on `main`, stop and switch to `develop` or a feature branch off `develop`.
- Skim the matrix for the area you will touch: what is `implemented` vs `planned`,
  and what proof it carries.

## 1. LOAD CONTEXT — make the agent understand the current code

Brownfield-first: read before reasoning. Use the lightest tool that answers the question.

| Need | Command |
| --- | --- |
| First-ever ck onboarding of the repo | `/ck:docs init` (one-time; the doc set already exists here — skip unless rebuilding docs) |
| Find files for a feature spanning dirs | `/ck:scout <keywords>` |
| "How does X work?" across modules | `gitnexus_query({query})` then `gitnexus_context({name})` |

Only load the lane-dependent docs the task needs (CONTEXT_RULES.md governs the budget);
do not bulk-read everything.

## 2. INTAKE — classify and record before editing

Classify with `docs/FEATURE_INTAKE.md`, then record. This is mandatory even for tiny work.

```bash
.\scripts\bin\harness-cli.exe intake --type <type> --summary "<work item>" --lane <tiny|normal|high-risk>
```

`<type>`: new spec · spec slice · change request · new initiative · maintenance request · harness improvement.

The lane chosen here drives every later choice. **Lane → ck plan-mode** (from CK_WORKFLOW.md §3):

| Lane | Planning | Implementation | Validation |
| --- | --- | --- | --- |
| **tiny** | usually none; `/ck:ask` if unsure | direct edit · `/ck:fix --quick` | quick check · `/ck:test` if logic changed |
| **normal** | `/ck:brainstorm` (if unclear) → `/ck:plan --hard` (+`--tdd` if refactor) → `story add` | `/ck:cook @plan.md` · `/ck:fix` | `/ck:test` + `/ck:code-review --pending` → `story update` |
| **high-risk** | `/ck:brainstorm` → `/ck:plan --deep`/`--two` → `/ck:scenario`; high-risk story + draft decision | `/ck:worktree` → `/ck:cook @plan.md` **interactive (not --auto)** | full `/ck:test` + `/ck:code-review` + `/ck:security` + validation report → `story verify` |

Any hard gate (auth, authorization, data loss/migration, audit/security, external
provider, weakening validation) → **high-risk**, pause for human confirmation if ambiguous.

## 3. PER-TASK LOOP — plan → clear → build → verify → trace

### 3a. Plan (normal / high-risk)
```bash
/ck:brainstorm "<question>"      # only if the approach is genuinely unclear
/ck:plan --hard "<feature>"      # --deep or --two for high-risk; add --tdd to preserve behavior
.\scripts\bin\harness-cli.exe story add --id <US-0XX> --title "<feature>" --lane <lane> --verify "<cmd>"
```
Plan output lands in `plans/<timestamp>-<slug>/plan.md` and names exactly which files may change.

### 3b. `/clear` — context hygiene (do not skip)
After the plan is written, run **`/clear`**. Start `cook` with a fresh window pointed
only at the plan file. This is the single biggest quality lever for a long session.

### 3c. Build
```bash
/ck:cook @plans/<dir>/plan.md    # feature; scout-first + no-side-effects gates enforced
# or
/ck:cook "<small change>" --fast # trivial UI/copy, no plan needed
/ck:fix --quick                  # type/lint/small bug
/ck:debug                        # complex bug → prove root cause before changing behavior
/ck:fix <ci-url>                 # CI/pipeline failure
```

### 3d. Verify (the gate — never claim pass without evidence)
```bash
/ck:test                         # regression: existing behavior must still pass
/ck:code-review --pending        # security, N+1, dead code, contract drift
/ck:simplify                     # optional: shorten/clarify without changing logic
```

### 3e. Record proof + trace (durable layer = source of truth)
```bash
.\scripts\bin\harness-cli.exe story update --id <US-0XX> --unit 1 --integration 1
.\scripts\bin\harness-cli.exe trace --story <US-0XX> --summary "<what changed>" --outcome success
```
**Run the trace even though ck wrote a journal.** A ck journal is evidence; the trace is the record.

Repeat 3a–3e for each work item in the session.

## 4. WRAP-UP — sync docs, commit, summarize

```bash
/ck:docs update                  # refresh API/architecture docs from the changes made
/ck:git cp                       # split commits, secret-scan, conventional message, push (develop/feature ONLY)
# team: /ck:git pr               # open PR → main (human-reviewed; never auto-merge to main)
/ck:journal                      # technical journal entry
/ck:watzup                       # end-of-day: what changed, what's done, what's pending
```

**Git boundary (non-negotiable, AGENTS.md):** ck build skills may commit on
`develop`/feature only. PR → `main` stays human-reviewed. `ship` / `vibe --ship` /
`review-pr` / `team` are **deferred until a green CI exists** (CK_WORKFLOW.md §5).

## 5. CLOSE — capture friction, confirm done

Before ending, ask the Task Loop's question: did product truth, validation
expectations, architecture rules, repeated failure patterns, or next-agent
instructions change?

```bash
.\scripts\bin\harness-cli.exe backlog add --title "<short>" --pain "<what was hard>" --risk tiny   # if friction
```

A task is **done** only when (HARNESS.md §Done Definition): change completed or
blocker documented · docs/stories/matrix current · validation run · trace recorded ·
missing capabilities logged · final response states what changed and what was not attempted.

---

## Quick reference — the canonical normal-lane session

```bash
git rev-parse --abbrev-ref HEAD                      # not main
.\scripts\bin\harness-cli.exe query matrix
/ck:scout <keywords>
.\scripts\bin\harness-cli.exe intake --type "spec slice" --summary "<feature>" --lane normal
/ck:brainstorm "<feature>"                           # if unclear
/ck:plan --hard --tdd "<feature>"
.\scripts\bin\harness-cli.exe story add --id US-0XX --title "<feature>" --lane normal --verify "<cmd>"
/clear
/ck:cook @plans/<dir>/plan.md
/ck:test
/ck:code-review --pending
.\scripts\bin\harness-cli.exe story update --id US-0XX --unit 1 --integration 1
/ck:docs update
/ck:git cp
.\scripts\bin\harness-cli.exe trace --story US-0XX --summary "<what changed>" --outcome success
/ck:journal
/ck:watzup
```

## Guard-rails carried from CK_WORKFLOW.md §6

- Harness owns governance (intake/lane, durable records, context budget, branch policy).
- ck owns execution quality (scout-first, no-side-effects, review iron law).
- **Run ck for the doing, record the Harness for the proving.**
