# 0017 Daily Session Loop Playbook (Brownfield ck × Harness)

Date: 2026-06-30

## Status

Accepted

## Context

`docs/CK_WORKFLOW.md` (decision 0009) maps ClaudeKit capabilities onto Harness
phases and lanes, and `docs/HARNESS.md` defines the durable Task Loop. Neither
expresses the work as a **literal, repeatable daily session** for this brownfield
project — the sequence of commands from opening a session to closing the day.
Operators were re-deriving that order each session, and the highest-leverage
context-hygiene step (`/clear` between plan and cook) was easy to skip.

This decision was recorded while refreshing the harness install (already at the
latest CLI `0.1.10`; merge-install confirmed no upstream files were missing).

## Decision

Add `docs/SESSION_LOOP.md`: a thin operational playbook that wraps the Harness
Task Loop as a daily loop (OPEN → LOAD CONTEXT → INTAKE → per-task
plan→/clear→build→verify→trace → WRAP-UP → CLOSE), routing each step through both
the ck brownfield commands and the `harness-cli` durable commands.

It **links to** `CK_WORKFLOW.md` §3 for lane→capability routing and `HARNESS.md`
for the Done Definition rather than duplicating them, so governance stays
single-sourced. The CLI binary was not changed; it is already the latest release.

## Alternatives Considered

1. Extend `CK_WORKFLOW.md` with a "daily loop" section instead of a new file —
   rejected to keep that doc focused on the lane×phase mapping and avoid bloating
   an already-dense reference.
2. Ship a runnable `scripts/session-loop.ps1` — deferred; the value is the
   sequence and gates, which a checklist conveys without adding a script to
   maintain. Can be added later if the loop proves stable.
3. Force-overwrite harness docs from upstream to "get latest" — rejected; the
   merge dry-run showed all 43 installer files already present, and force would
   clobber CMCnew-tuned docs (e.g. the local `CK_WORKFLOW.md`) for no gain.

## Consequences

Positive:

- One canonical session sequence; less per-session re-derivation.
- `/clear` context-hygiene step is now explicit and ordered.
- Governance stays single-sourced (links, not copies).

Tradeoffs:

- One more doc to keep aligned if `CK_WORKFLOW.md` or `HARNESS.md` change; the
  links and "do not duplicate" stance limit drift.

## Follow-Up

- Revisit the deferred `session-loop.ps1` once the loop is exercised across
  several sessions.
- Re-evaluate Tier-3 ck skills (`ship`/`vibe --ship`/`review-pr`/`team`) when a
  green CI exists (Jenkins), per CK_WORKFLOW.md §5.
