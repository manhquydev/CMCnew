# ClaudeKit Capabilities (installed inventory + when to use)

Status: Adopted — see decision `0018-ck-capabilities-reference`.

This is the **what-is-installed + when-to-use** companion to the two existing docs:

- `docs/CK_WORKFLOW.md` — **how to route** ck onto Harness phases/lanes.
- `docs/SESSION_LOOP.md` — **what order** to run it in, day to day.
- **this file** — **which capabilities exist** in this project and when each helps.

> **Verified, not transcribed.** Every `/ck:` command below resolves to a real skill
> under `.claude/skills/` (confirmed 2026-06-30). The external catalog
> ("DANH MỤC TOÀN DIỆN…") is marketing-flavored and partially inaccurate for this
> install — see §7. `scripts/verify-ck-docs.ps1` keeps this file honest by asserting
> every `/ck:` reference here still maps to an installed skill.

---

## 0. How to use this doc

**Invoking:** `/ck:<skill>` are slash commands typed in the session (e.g. `/ck:cook`).
`@path` passes a file to a command (e.g. `/ck:cook @plan.md`). The §2 agents are not
slash commands — spawn them via the Task tool. (5 commands resolve under the `ck-`
engine prefix — `/ck:plan`→`ck-plan`, `debug`, `code-review`, `security`, `scenario` —
but you still type the short `/ck:` form.)

**Lane in 10 seconds** (full rules in `FEATURE_INTAKE.md`):
- **tiny (T)** — 0–1 risk flags; narrow edit, copy, docs.
- **normal (N)** — story-sized, bounded blast radius.
- **high-risk (H)** — ANY auth / authorization / data-loss / audit-security / external-provider / validation-weakening gate. Pause for human confirmation if ambiguous.

**Lane column legend:** the T/N/H tag = lanes the command is appropriate *in*.
`—` = not lane-gated / deferred (see §6).

## 1. Engineer skills by Harness phase

### Intake / understand
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:scout <kw>` | find files for work spanning many dirs | T·N·H |
| `/ck:ask "<q>"` | quick read-only design question, no edits | N·H |
| `/ck:research "<topic>"` | external/unknown tech needs synthesized report | N·H |
| `/ck:find-skills` | unsure which skill fits the task | any |

### Plan
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:brainstorm "<x>"` | approach unclear; weigh trade-offs before committing | N·H |
| `/ck:plan --hard` | phased plan + research + red-team (default for features) | N |
| `/ck:plan --deep` / `--two` | high-risk: per-phase validate, or two competing approaches | H |
| `/ck:plan --fast` | trivial work, skip research/red-team | T |
| `/ck:plan --parallel` | independent modules buildable in parallel phases | N·H |
| `/ck:plan ... --tdd` | composable: tests-first to preserve existing behavior (brownfield) | N·H |
| `/ck:scenario --focus <dim>` | enumerate edge cases (authorization/security/…) | H |

### Build
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:cook @plan.md` | implement an approved plan (scout-first, no-side-effects gates) | N·H |
| `/ck:cook "<x>" --fast` | trivial change, no plan needed | T |
| `/ck:bootstrap` | scaffold a brand-new sub-project from scratch | N |
| `/ck:better-auth` | implement type-safe auth patterns (hard-gate: high-risk) | H |

### Debug / fix
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:fix --quick` | type/lint/small bug | T |
| `/ck:fix` / `/ck:fix <ci-url>` | defect with implement→verify→prevent; or a failing CI run | N |
| `/ck:debug` | complex bug — prove root cause before changing behavior | N·H |

### Validate
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:test` | diff-aware regression: prove existing behavior still passes | T·N·H |
| `/ck:code-review --pending` | staff-level adversarial review (security, races, contracts) | N·H |
| `/ck:security <scope>` | STRIDE+OWASP review for auth/data/external work | H |
| `/ck:security-scan` | scan for OWASP-class issues + secret leaks | N·H |
| `/ck:review-pr` | review an open PR (deferred until green CI — see CK_WORKFLOW §5) | — |

### Release / git
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:git` | conventional commits + secret-scan + push (develop/feature only) | any |
| `/ck:worktree "<x>"` | isolate high-risk work in its own worktree | H |
| `/ck:deploy` | platform-detected deploy (this repo deploys via Jenkins on `main`) | H |
| `/ck:ship` / `/ck:vibe` | full quality→push→PR (deferred until green CI — CK_WORKFLOW §5) | — |

### Docs / orchestration / close
| Command | Use when | Lane |
| --- | --- | --- |
| `/ck:docs` | init or update project docs from code changes | any |
| `/ck:journal` | record technical journal entry (failures + lessons) | any |
| `/ck:watzup` | end-of-day summary: changed / done / pending | any |
| `/ck:project-organization` | normalize file/dir structure to convention | T·N |
| `/ck:retro` / `/ck:retro --compare` | sprint retrospective from git + health metrics | — |
| `/ck:team` | multi-session parallel teammates (Opus, experimental — deferred) | — |
| `/ck:llms` | generate `llms.txt` so other LLMs can read the project | T |
| `/ck:mintlify` | build a Mintlify docs site | N |

> Picked a command? Run it inside the full phase sequence in `SESSION_LOOP.md`
> (intake → plan → /clear → build → verify → trace).

## 2. Engineer agents (subagents)

Installed under `.claude/agents/` (13): `planner`, `fullstack-developer`, `debugger`,
`tester`, `code-reviewer`, `code-simplifier`, `docs-manager`, `project-manager`,
`journal-writer`, `git-manager`, `ui-ux-designer`, `brainstormer`, `researcher`.
`scout`/`scout-external` and `mcp-manager` exist as runtime agent types. Spawn via the
Task tool; read-only roles (`code-reviewer`, `researcher`, `git-manager`, `scout`) never
mutate. **Note:** simplification is the `code-simplifier` *agent* (and `/ck:cook`'s
conditional-simplify step) — there is no `simplify` skill in this install.

## 3. Tool & integration skills

Invoked as skills (not `/ck:` commands): `mermaidjs-v11` (diagrams), `excalidraw`
(hand-drawn diagrams), `chrome-profile`/`agent-browser` (browser automation, QA),
`web-testing` (E2E), `preview` (visual explanations), `repomix` (pack repo for context),
`gitnexus`/`tech-graph` (code-intelligence graph), `use-mcp`/`mcp-builder` (MCP tools),
`ai-artist`/`ai-multimodal`/`media-processing`/`html-video`/`remotion`/`threejs`
(media/3D). Reach for these only when the task needs them (keeps context lean).

## 4. Context engineering (token discipline)

The catalog's "4-bucket" strategy, expressed for this repo (aligns with `CONTEXT_RULES.md`):

1. **Write** — persist plans/reports/docs to files, don't hold them in context.
2. **Select** — pull only the code/docs the task needs (`/ck:scout`, not bulk reads).
3. **Compress** — summarize subagent results before returning to the main loop.
4. **Isolate** — split large work into scoped subagent tasks (own context each).

Supporting skills: `context-engineering` (the discipline), `coding-level` (the
`/coding-level 0–5` verbosity control; this repo runs ELI5 level 0 by operator choice —
see CK_WORKFLOW §7). Use `/clear` between plan and build (SESSION_LOOP §3b).

## 5. Namespaces

- **`/ck:`** — Engineer Kit (everything above). The working set for this repo.
- **`/ckm:`** — Marketing Kit (27 agents, growth skills). **Out of scope** for this
  ERP/LMS engineering repo; the `copywriting` skill is the only adjacent one installed.
  Do not route engineering work through `/ckm:`.

## 6. Tier policy (unchanged from CK_WORKFLOW §5)

Tier-1 (adopt now) = the Intake→Validate sets above. Tier-3 (`ship`, `vibe --ship`,
`review-pr`, `team`) stay **deferred until a green CI exists** — GitHub Actions billing
is blocked and Jenkins runs full pipeline only on `main`.

## 7. Catalog reconciliation (claims vs this install)

| Catalog claim | Reality in this install |
| --- | --- |
| `shadcn-ui` command | **Not installed.** Use `tanstack` / `ui-styling` / `frontend-design`. |
| `storage` (R2/S3) skill | **Not installed.** |
| `mcp-management` skill | Present as `use-mcp` + `mcp-builder`. |
| `simplify` command (implied) | **No such skill** — use `code-simplifier` agent. |
| "40% token savings", "2M token context", "Nano Banana 2" | Marketing claims; unverified — do not cite as fact. |

Treat the external catalog as a lead, never as truth. Verify against `.claude/skills/`
(and let `scripts/verify-ck-docs.ps1` enforce it).
