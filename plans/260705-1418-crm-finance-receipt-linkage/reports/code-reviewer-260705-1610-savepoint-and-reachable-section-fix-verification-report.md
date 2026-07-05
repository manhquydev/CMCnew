# Fix Verification Report — Savepoint Recovery + Reachable-Section Gate

Date: 2026-07-05
Scope: re-verification of 2 claimed fixes from prior review
(`code-reviewer-260705-1513-crm-finance-receipt-linkage-implementation-review-report.md`):
CRITICAL (transaction-abort on email-collision retry) and HIGH (direct-URL
`/overview` bypass for ungated roles).

## Verdict: SAFE TO COMMIT — both issues confirmed fixed, no regressions found

---

## 1. CRITICAL — email-collision savepoint fix (`apps/api/src/routers/finance.ts`)

Read the full `receiptApprove` mutation end-to-end (lines 645-940+).

**(a) Savepoint syntax/semantics — correct in both blocks.**
- New-ParentAccount insert block (line 774-793): `SAVEPOINT sp_parent_email` issued
  unconditionally before the risky raw INSERT, `ROLLBACK TO SAVEPOINT sp_parent_email`
  issued inside the `catch` before the retry insert (with `email: NULL`). This is the
  textbook fix for Postgres 25P02 (transaction aborted after any statement error) —
  `ROLLBACK TO SAVEPOINT` clears the aborted-transaction flag so subsequent statements
  on the same connection succeed again.
- Sibling `propagatedEmail` block (line 891-900): identical pattern with a distinctly
  named savepoint (`sp_propagated_email`) — no name collision risk since the two blocks
  are mutually exclusive at runtime (see `emailCollisionHandled` below) and even if they
  weren't, the names differ.
- Postgres auto-releases a savepoint on outer transaction COMMIT even if it's never
  rolled back to — creating a savepoint that's never used is a no-op, not a leak. Both
  savepoints are safe on the non-collision happy path.

**(b) `emailCollisionHandled` scoping — correct.**
- Declared at line 763, before the `if (!parentAcc)` block, in the same lexical scope
  as `parentAcc` itself (inside the `else` new-student branch). Only ever set `true`
  inside the insert-retry `catch` (line 793). Read at line 886 to gate the
  `propagatedEmail` block, which is later in the same scope. No hoisting or
  closure-capture issue.
- When `parentAcc` was found by phone (not the `!parentAcc` branch), `emailCollisionHandled`
  stays `false` and only the `propagatedEmail` block's own savepoint/catch runs — correct,
  since the insert-collision block never executed for that path.

**(c) No orphaned-savepoint risk on the non-collision path.** Confirmed above (Postgres
releases savepoints at COMMIT automatically; `RELEASE SAVEPOINT` is optional, not required).

**Verified empirically, not just by static read:** ran
`pnpm --filter @cmc/api exec vitest run test/student-provisioning-edge-cases.int.test.ts`
against a live Postgres DB — all 9 tests pass, including
`EC-EMAIL: second new-parent receipt reusing an already-claimed email approves cleanly`.
Read the test body (lines 154-214): it creates receipt A (claims `sharedEmail`), approves
it, then creates receipt B with a *different phone* but the *same* `sharedEmail`, approves
it, and asserts:
- `approvedB.status === 'approved'` (no 500/thrown 25P02)
- `parentB.email === null` (collision correctly detected and handled)
- `guardian.findFirst` for `(parentB.id, approvedB.studentId)` is non-null — proof the
  **rest** of the transaction (student create, guardian upsert) committed, not just that
  no exception leaked. This is the right assertion: a bare try/catch without savepoints
  would have left the transaction in the aborted state, and the guardian upsert (which
  runs unconditionally later in the same `tx`) would have thrown 25P02 on `INSERT`, which
  would surface as an unhandled 500 from the mutation — the test would fail at
  `receiptApprove` itself, before ever reaching the guardian assertion.

**One residual (non-blocking) observation, not part of the original CRITICAL finding:**
both `catch {}` blocks (line 780, line 897) are bare catches — they treat *any* error
from the risky statement as "the email is already claimed" and retry/log accordingly.
If the INSERT/UPDATE fails for an unrelated reason (e.g. a different constraint, a
transient connection error), the code would mislabel it as an email collision in the
audit log (`"email X already belongs to another account"`) even though that wasn't the
actual cause. This is a pre-existing pattern (the comment explicitly says the
`propagatedEmail` catch mirrors the same non-blocking philosophy the insert catch now
also uses) — not introduced by this fix, and not a data-loss or auth issue, just an
imprecise audit-log message. Recommend narrowing to catch Postgres error code `23505`
specifically in a follow-up, not a blocker for this change.

## 2. HIGH — `isReachableSection` direct-URL gate (`apps/admin/src/App.tsx`)

Read lines 608-634. `isReachableSection(key)` (line 617-623):
```
if (!ALL_SECTION_KEYS.has(key)) return false;
const gate = NAV_GATES[key as SectionKey];
if (gate.kind === 'open') return true;
if (gate.kind === 'superAdmin') return me.isSuperAdmin;
return can(me.roles, me.isSuperAdmin, gate.module, gate.action);
```
This mirrors `shell.tsx`'s `visible()` (line 633-638) permission-gate logic exactly.
`knownSection` now requires `isReachableSection`, not just set-membership — a direct URL
to a section the role can't use falls through to `defaultSection(me)` via the existing
`useEffect` redirect (line 630-634), same code path as an unknown/garbage section.

**Verified `NAV_GATES.overview` mapping** (`apps/admin/src/nav-permissions.ts:34`):
`{ kind: 'permission', module: 'dashboard', action: 'summary' }` — matches the claim.

**Verified role/permission matrix** (`packages/auth/src/permissions.ts:78-79`):
`dashboard.summary` is granted only to `['giam_doc_kinh_doanh', 'giam_doc_dao_tao']`
(super_admin bypasses via `can()`'s super_admin short-circuit, standard pattern in this
codebase). `giao_vien`/`cskh` are absent from that list, so `can()` returns `false` for
them and `isReachableSection('overview')` correctly returns `false` → direct URL entry
redirects them to `defaultSection(me)` instead of rendering the panel that would 403.
Directors and super_admin pass `can()` and reach `/overview` directly, matching the
task's expected behavior (the sidebar substitutes a Cockpit link for those roles, but
that's a nav-affordance choice, not a permission removal — they still hold
`dashboard.summary` and the panel would not 403 for them).

**No circular import / build issue:** `apps/admin/src/App.tsx` imports `NAV_GATES` from
`./nav-permissions.js` (line 17), which is a pure data/permission-check module with no
import back to `App.tsx` — confirmed by reading `nav-permissions.ts` directly (no import
of `App` or `shell` found in that file). `pnpm --filter @cmc/admin exec tsc --noEmit -p .`
ran clean (no output = success).

## 3. Build / type-check verification

- `pnpm --filter @cmc/api exec tsc --noEmit -p .` — clean (no output).
- `pnpm --filter @cmc/admin exec tsc --noEmit -p .` — clean (no output).

## 4. Test suite verification

- `pnpm --filter @cmc/admin exec vitest run src/__tests__/` — 4 files, 28 tests, all pass
  (`nav-consistency`, `nav-teacher-consolidation`, `nav-director-kd-cockpit-consolidation`,
  `nav-director-dt-cockpit-consolidation`).
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts
  test/student-provisioning-edge-cases.int.test.ts test/student-provisioning-approve.int.test.ts
  test/crm-finance-receipt-linkage.int.test.ts test/onboarding-to-lms-timeline.int.test.ts
  test/email-outbox-router.int.test.ts` — 6 files, 68 tests, all pass.

No new failures, no skipped/xfail tests observed.

## Summary

| Issue | Status |
|---|---|
| CRITICAL: transaction-abort not recovered on email-collision retry | **Fixed** — savepoint pattern verified correct by static read + live-DB integration test proving post-collision commit of student/guardian rows |
| HIGH: `/overview` reachable via direct URL for ungated roles | **Fixed** — `isReachableSection` re-checks `NAV_GATES` permission, verified against actual role/permission matrix |
| New issues introduced | None blocking. One informational note: bare `catch {}` in both email-retry blocks over-attributes any error as "email collision" (pre-existing pattern, not introduced by this fix) — recommend narrowing to Postgres code `23505` in a follow-up, not blocking. |

## Unresolved Questions

None — both fixes independently verified via static code read, permission-matrix
cross-check, and passing live-DB/browser-equivalent test runs.
