---
title: "P5 — Lifecycle enforcement (withdrawn/paused → block LMS + attendance)"
phase: 5
status: pending
risk: high
owns: [packages/auth/src/lms.ts, apps/api/src/routers/attendance.ts]
---

# P5 — Lifecycle enforcement

## Context
- Source: brainstorm §PLAN5.5. `setStudentLifecycle` (`aftersale.ts:117`) only updates `student.lifecycle` + logs; no downstream enforcement. Withdrawn/paused students keep full LMS access; attendance blocks only on `enrollment.status`, not lifecycle.
- Anchors (verified): enum `StudentLifecycle { admitted active on_hold transferred withdrawn completed }` `schema.prisma:42`; `parentSession` `packages/auth/src/lms.ts:34-54` (joins ALL children via `guardians.map(g=>g.student)`); `studentSession` select (currently `{id,fullName,facilityId}`) `lms.ts:56-73`; `loginStudent` `lms.ts:80`; `mintParentSession` `lms.ts:97`; `resolveLmsSession` live re-check `lms.ts:107-115`; attendance left-class guard `attendance.ts:60`.
- **Blocked set is FIXED (operator FINAL, do NOT re-litigate): EXACTLY `{ on_hold, withdrawn, transferred }`.** `completed`, `active`, `admitted` do NOT block LMS access. `completed` students MUST keep read access (they fetch transcript/certificate post-completion — P4's whole point). "paused" = `on_hold`. There is no open question here.

- `BLOCKED_LMS_LIFECYCLE = { on_hold, withdrawn, transferred }` — one shared const, used by both session resolvers.
- **Student path gate:** `studentSession` (`:56-73`) rejects (returns null) when the single student's lifecycle is blocked → covers BOTH `loginStudent` (`:80`) and `resolveLmsSession` re-check (`:107`) since both call `studentSession`. Result: blocked student can't log in, and an active session dies on the next request after the student is set to blocked.
- **Parent path gate (C4 — materially different, NOT "same as student"):** `parentSession` (`:34-54`) must PER-CHILD filter, never reject the whole session. A parent with ANY non-blocked child must still log in. Logic: add `lifecycle:true` to the `guardians.include.student.select`, then drop children whose lifecycle is blocked from `students`/`studentIds`/`facilityIds`. Only when EVERY child is blocked does the parent session become empty (still resolves, just with no accessible children). The withdrawn child's grades/attendance/certificate/mark-able UI become inaccessible; sibling children are unaffected.
- **Attendance gate:** `attendance.markAll`/`mark` skip/reject students whose lifecycle is blocked (in addition to existing enrollment.status guard `:60`).
- **Visible state:** return lifecycle so ERP/LMS can show status badge (data already on student; ensure surfaced).

## Files
- Modify: `packages/auth/src/lms.ts` — add `lifecycle` to BOTH selects (`studentSession` `:60` AND `parentSession` `:39`); gate `studentSession` (reject) and `parentSession` (per-child filter). **Shared `@cmc/auth` package — affects all LMS request auth; process-lifetime module, no per-request state added.** Before editing, run `gitnexus_impact` on `resolveLmsSession`, `parentSession`, `studentSession` (M3) — called from `apps/api/src/index.ts` (`/files/certificate`, `/sse/notifications`, every `lmsProcedure`) and re-exported via `packages/auth/src/index.ts`; report blast radius before change.
- Modify: `apps/api/src/routers/attendance.ts` (extend guard). **File shared with P3 → P5 runs AFTER P3 merges.**
- No schema change (enum + column exist) → **no migration**.

## Implementation steps
1. Define `BLOCKED_LMS_LIFECYCLE = { on_hold, withdrawn, transferred }` (one const).
2. `studentSession`: add `lifecycle:true` to select; return null when the student's lifecycle ∈ blocked set. This covers login + per-request re-check (both go through `studentSession`).
3. `parentSession`: add `lifecycle:true` to the child select; filter OUT blocked children from `students`/`studentIds`/`facilityIds`; keep the session alive as long as it resolves (do NOT null out the whole parent session when one child is blocked).
4. Attendance: load student lifecycle alongside enrollment; skip/reject blocked.
5. Confirm ERP shows lifecycle badge (student already has field).

## Tests / validation
- Int: withdrawn/on_hold/transferred student login rejected; active session invalidated on next request after set-to-blocked.
- Int (C3): `completed` student CAN still log in and read transcript/certificate; `active`/`admitted` unaffected.
- Int: attendance markAll skips withdrawn/on_hold/transferred student.
- Int (C4): parent with 2 children, 1 withdrawn → parent STILL logs in; withdrawn child dropped from `studentIds`/data; other child fully accessible. Parent with ALL children blocked → session resolves empty (no crash).
- Regression: existing LMS auth tests (`lmsCaller` helper) still green.

## Risks / rollback
- Risk (high, mitigated): mis-scoped blocked set locks out `completed` students → blocked set is FIXED to `{on_hold, withdrawn, transferred}`; `completed` explicitly excluded (C3). Test asserts completed access.
- Risk (high, mitigated): naive parent gate locks a parent out of ALL children when one is blocked → C4 mandates per-child filter, not whole-session reject. Test asserts sibling access preserved.
- Risk (med): gating in shared `@cmc/auth` affects every LMS request → run `gitnexus_impact` first (M3); covered by re-check + `lmsCaller` regression.
- Rollback: revert code; no data change. Fast revert since no migration.

## Blockers
- Depends on P1 (student lifecycle path) and P3 (attendance.ts merged first). Serialize after both.
