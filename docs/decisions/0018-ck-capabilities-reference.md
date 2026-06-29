# 0018 ClaudeKit Capabilities Reference

Date: 2026-06-30

## Status

Accepted

## Context

The harness documented ck integration in `CK_WORKFLOW.md` (routing) and
`SESSION_LOOP.md` (daily order), but covered only ~18 Tier-1 skills. ~70 other
installed ck skills, the engineer agents, the context-engineering discipline, and
the `/ckm:` namespace were undocumented. An external catalog of ClaudeKit
capabilities was provided, but it is marketing-flavored and partially inaccurate
for this install (e.g. lists `shadcn-ui` and a `storage` skill that are not
installed; implies a `/ck:simplify` skill that does not exist).

## Decision

Add `docs/CK_CAPABILITIES.md`: a **verified** inventory of installed ck skills and
agents, grouped by Harness phase with when-to-use and lane guidance, the
context-engineering discipline, the `/ck:` vs `/ckm:` namespace boundary, and an
explicit catalog-reconciliation section. It is built from the `.claude/skills/`
listing, not from the catalog's claims.

Add `scripts/verify-ck-docs.ps1`: a checker that asserts every `/ck:<skill>`
referenced in the harness docs resolves to an installed skill
(`.claude/skills/<name>` or `ck-<name>`). This caught and fixed a stale
`/ck:simplify` reference in `SESSION_LOOP.md` (no such skill — the mechanism is the
`code-simplifier` agent).

## Alternatives Considered

1. Transcribe the external catalog directly — rejected; it contains unverified and
   incorrect claims for this install.
2. Document the full ~90-skill inventory including `/ckm:` marketing — rejected as
   noise for an ERP/LMS engineering repo; documented the engineer-relevant subset
   and noted `/ckm:` is out of scope.
3. Fold everything into `CK_WORKFLOW.md` — rejected; that doc is dense and focused
   on routing. Capability inventory is a separate concern (single responsibility).

## Consequences

Positive:

- Operators can see what ck capabilities exist and when to use them, verified.
- `verify-ck-docs.ps1` prevents future doc drift between harness docs and installed
  skills.
- Catalog reconciliation stops marketing claims from being cited as fact.

Tradeoffs:

- Another doc to keep current as skills are added/removed; the checker limits the
  worst drift (broken references) automatically.

## Follow-Up

- If marketing work ever enters scope, document the `/ckm:` set separately.
- Consider wiring `verify-ck-docs.ps1` into CI alongside `verify-harness.ps1`.
