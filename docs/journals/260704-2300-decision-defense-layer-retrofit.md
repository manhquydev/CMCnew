# Decision Defense Layer: Fixing Undocumented-Rule Breakage in Production

**Date:** 2026-07-04 23:00  
**Severity:** High (silent production correctness failure, systemic discovery)  
**Component:** Harness infrastructure, decision registry, agent protocol  
**Status:** Resolved (commit 9b5d277, code review passed)

## What Happened

A shift-registration ticket-lock rule broke in production today: the API was supposed to prevent a user from having more than one open (draft OR submitted) registration at a time. What actually shipped was "prevent more than one submitted" — missing the draft check entirely. Git log traced it back to the **very first commit** of the feature (not a later regression). The rule worked-as-intended on the manager UI side (visual lock), but the API guard was incomplete from day one.

Investigation revealed the root cause: the rule was **decided verbally, never written down anywhere.** Not in the 2026-06-30 brainstorm doc, not in the API design, not in `docs/decisions/`. When the original developer implemented the guard, they encoded a partial interpretation without a source of truth to catch the incompleteness. This reveals a systemic gap: **there is no enforcement mechanism preventing undocumented decisions from silently breaking production.**

This connects directly to a harness self-audit from 2026-06-25 that had already flagged: "ck routing is advisory, no hook enforces" — we knew the harness was trust-based, but we hadn't built the missing layer to make decisions themselves hard requirements rather than suggestions.

## The Brutal Truth

This is infuriating because it's entirely preventable. The rule exists. It was decided (verbally, in a meeting). But the decision *itself* disappeared the moment the meeting ended, leaving only a half-implemented API guard as evidence. A future developer reading the code would have no way to know whether the guard was complete or incomplete — they'd have to reverse-engineer the intent from the UI or ask someone. And if they ask someone, and that person forgets, they'll ship a broken rule again.

The embarrassing part: we have a `docs/decisions/` directory with 34 existing decisions, all hooked into the harness via `harness-cli`. The infrastructure existed. We just didn't use it for this one. It's a 100% execution gap, not a design gap. And it cost us a production incident to notice.

The deeper frustration: code review caught the incomplete guard scenario in theory (permission-schema-as-specification approach), but *no one* asked "where is the written rule that says ticket-lock should be draft+submitted, not just submitted?" Code review doesn't catch gaps that match the spec it was given — it only catches deviations from the spec. If there's no spec, code review has no teeth.

## Technical Details

**The Broken Guard** (`apps/api/src/routers/shift-registration.ts`):
```typescript
// BEFORE (broken, still in production until now)
const existingTicket = await db.shiftRegistration.findFirst({
  where: { userId, status: 'submitted' } // Missing 'draft'!
});
if (existingTicket) throw new Error('User has a pending registration');

// SHOULD HAVE BEEN
const existingTicket = await db.shiftRegistration.findFirst({
  where: { userId, status: { in: ['draft', 'submitted'] } }
});
if (existingTicket) throw new Error('User has a pending registration');
```

**The Fix: Decision Defense Layer** (commit 9b5d277):

Built on the *existing* infrastructure, not a parallel system:

1. **`docs/DECISION_INDEX.md`** — New grep-able pointer table (one row per decision), mapping:
   - Decision number + title
   - Which code area it affects (`shift-registration.ts`, `AGENTS.md`, etc.)
   - Link to the full decision doc
   - Current status (implemented, superseded, deferred)
   - All 34 prior decisions cataloged + new retrofit entry for 0035

2. **`docs/decisions/0035-shift-registration-ticket-lock.md`** — Retrofit the missing decision:
   - Documents the rule: "User may only have one open (draft or submitted) registration at a time"
   - Explicitly records: "This was decided 2026-06-30 in shift-registration design meeting but was never written down before 2026-07-04"
   - References the shipped code (`shift-registration.ts` line 87–90)
   - Rationale: prevents duplicate registration accumulation, ensures predictable UX
   - Impact: affects `create()` and `submit()` mutations

3. **`AGENTS.md` + `CLAUDE.md`** — Added "Decision Lookup (Hard Rule)" section:
   - Before editing files that match a decision pattern, agent *must* read + restate the governing decision
   - Explicitly blocks silent reinterpretation of business logic
   - Example: "Before modifying shift-registration.ts, check DECISION_INDEX.md → decision 0035 for the ticket-lock invariant"
   - Note: both files are always-loaded into every session, so this is now mandatory protocol

**Incidental Bug Fix** (during decision catalog pass):
- Found two decision files both numbered `0032` (duplicate decision numbers)
- Filed as `harness-cli backlog #14` (not blocking, but must consolidate before the next 0036+)

## What We Tried

**Option A: Parallel decision system** — Create a separate `decision-hooks/` with agent-enforced checks.  
Rejected: we already have `docs/decisions/` + `harness-cli decision`. Building a second system splits the authority and makes future updates fragmented.

**Option B: Mandatory decision refs in code** — Add `@decision-0035` comments above every guard.  
Rejected: code comments don't scale (becomes noise, easy to lose in refactors). The decision doc is the source of truth; the code ref should be reverse (decision → code), not forward.

**Option C: Build on the existing harness** — Catalog all decisions, add agent protocol to *require* decision lookup before edits.  
Chosen: uses the inventory and CLI that already exist, adds protocol to `AGENTS.md` (the file agents *already read*), and is reversible if better tooling emerges later.

## Root Cause Analysis

1. **Verbal decisions disappear.** Meeting notes in Slack or email are not durable. The decision exists in people's memory, not in a place where code can reference it.

2. **The API guard was a best-guess without a spec.** The developer implemented "user can't create when there's a submitted ticket", which is the most obvious interpretation. But "draft should also block" requires reading the design rationale, which wasn't documented.

3. **Code review doesn't catch specification gaps.** Review checked "is this guard correctly coded?" but not "is this guard complete?" Those are different questions. Without the decision doc, review has no way to answer the second one.

4. **Harness was advisory only.** The 2026-06-25 audit correctly identified this: decisions were "soft" (you can ignore them if you're in a hurry). We had the infrastructure but no enforcement.

5. **This is repeatable.** The shift-registration rule isn't unique. Every API invariant, every permission rule, every workflow step is vulnerable to the same silent incompleteness if it lives only in verbal history.

## Lessons Learned

1. **Decisions must be written down before or immediately after implementation.** "We'll document it later" doesn't work — later never comes, or someone else is already implementing it from memory of a stale conversation.

2. **The decision doc is the spec.** When a decision exists, code review should check the code against the decision, not against an ad-hoc interpretation. This means the decision *must be accessible* (DECISION_INDEX.md makes it greppable) and *must be in the agent's context* (added to AGENTS.md).

3. **Hard rules in agent protocol beat soft suggestions.** Adding the Decision Lookup rule to AGENTS.md makes it a *mandatory* check (agents auto-load AGENTS.md), not a "best practice" (which gets skipped when rushed). This is the enforcement we were missing.

4. **Retrofitting a decision is better than inventing a new one.** Decision 0035 documents what was *actually built and deployed*, not what we wish we had built. This is honest — it says "this decision was made implicitly through code, we're making it explicit now."

5. **Incidental gaps surface during inventory work.** The duplicate 0032 numbers were harmless until today, but they would have caused merge chaos if two branches both tried to create 0033. Cataloging forces you to count.

## Next Steps

- [x] Brainstorm: recognize the incident, identify the systemic gap, choose Option C (harness-based).
- [x] Plan: created `plans/260704-2303-decision-defense-layer-retrofit/` with phases.
- [x] Red-team (mandatory, since always-loaded files changed): caught 2 real gaps:
  - Phase 02 didn't account for marker-comment blocks (`<!-- HARNESS:BEGIN/END -->`, `<!-- gitnexus:start/end -->`) that get regenerated by tooling — edits must land in the safe gaps.
  - Phase numbering (1,2,3) didn't match dependency order (catalog→retrofit decision→protocol). Reordered to 3→1→2 to ensure the decision doc exists before agent protocol references it.
- [x] Implementation: built DECISION_INDEX.md, 0035 doc, AGENTS.md + CLAUDE.md edits (verified: 0 deletions, only insertions in the safe marker gaps).
- [x] Code review gate (post-implementation): all 35 decisions accounted for, the 0035 rule verified line-by-line against shipped code (`shift-registration.ts` 87–90), duplicate 0032 filed for next harness cleanup, 0 regressions.
- [ ] Next full plan that touches a guarded file: use the Decision Lookup rule to cite the decision in the plan.
- [ ] (Future harness improvement): automate the DECISION_INDEX.md catalog via `harness-cli` to keep it in sync as decisions are added.

**File paths:**
- Decision catalog: `docs/DECISION_INDEX.md`
- Shift-registration decision (retrofit): `docs/decisions/0035-shift-registration-ticket-lock.md`
- Agent protocol update: `AGENTS.md` (new section after FEATURE_INTAKE mention)
- Project protocol update: `.claude/rules/CLAUDE.md` (same section)
