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
- Anchors (verified): enum `StudentLifecycle { admitted active on_hold transferred withdrawn completed }` `schema.prisma:42`; `loginStudent` `packages/auth/src/lms.ts:80`; `studentSession` select (currently `{id,fullName,facilityId}`) `lms.ts:56-61`; `resolveLmsSession` live re-check `lms.ts:107-114`; attendance left-class guard `attendance.ts:60`.
- Operator note: "paused" = `on_hold` in enum. Blocking set = `{ on_hold, withdrawn, transferred, completed }` for LMS access; confirm `completed` should still allow read-only view (likely yes) → see Open Qs.

## Requirements
- LMS login gate: `loginStudent` rejects when student lifecycle is in blocked set.
- LMS live re-check gate: `resolveLmsSession` (per-request) also rejects blocked lifecycle → active sessions die when student is paused/withdrawn mid-session.
- Attendance gate: `attendance.markAll`/`mark` skip/reject students whose lifecycle is blocked (in addition to existing enrollment.status guard `:60`).
- Visible state: return lifecycle so ERP/LMS can show status badge (data already on student; ensure surfaced).

## Files
- Modify: `packages/auth/src/lms.ts` (add `lifecycle` to `studentSession` select `:60`; gate in `loginStudent` `:80` + `resolveLmsSession` `:107`). **Shared `@cmc/auth` package — affects all LMS request auth; process-lifetime module, no per-request state added.**
- Modify: `apps/api/src/routers/attendance.ts` (extend guard). **File shared with P3 → P5 runs AFTER P3 merges.**
- No schema change (enum + column exist) → **no migration**.

## Implementation steps
1. Add `lifecycle: true` to `studentSession` student select.
2. Define `BLOCKED_LMS_LIFECYCLE` set; in `studentSession` return null (or in `loginStudent`/`resolveLmsSession` reject) when blocked.
3. Decide gate placement: gating in `studentSession` covers BOTH login + re-check (DRY) — preferred. Verify parent sessions unaffected (parent gate = per-child, out of scope unless all children blocked).
4. Attendance: load student lifecycle alongside enrollment; skip/reject blocked.
5. Confirm ERP shows lifecycle badge (student already has field).

## Tests / validation
- Int: withdrawn student login rejected; active session invalidated on next request after set-to-withdrawn.
- Int: attendance markAll skips withdrawn/on_hold student.
- Int: active student unaffected; parent access to non-blocked child unaffected.
- Regression: existing LMS auth tests (`lmsCaller` helper) still green.

## Risks / rollback
- Risk (high): over-broad gate locks out legitimate `completed` students from viewing history → confirm blocked set with operator before coding.
- Risk (med): gating in shared `studentSession` affects every LMS request → covered by re-check test.
- Rollback: revert code; no data change. Fast revert since no migration.

## Blockers
- Depends on P1 (student lifecycle path) and P3 (attendance.ts merged first). Serialize after both.
