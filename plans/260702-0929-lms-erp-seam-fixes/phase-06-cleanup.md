# Phase 06 — Cleanup: classBatch.update UI + de-cast + delete loginParent + /showcase gate

## Context links
- Brainstorm §1, §4 W3, D6

## Overview
- Date: 2026-07-02
- Description: Wire `classBatch.update` into class edit UI; replace `as any`/`as unknown as` tRPC casts with typed AppRouter client in 6 panels (15 casts, M6); delete `lmsAuth.loginParent` (contradicts passwordless-OTP); gate LMS `/showcase` DEV-only. (GradingThreshold drop is in P1.)
- Priority: P1
- Implementation status: pending
- Review status: not started
- Mostly independent of P1–P5 (different files); can run in parallel except no shared-file overlap.

## Key Insights
- `classBatch.update` backend + permission + tests shipped in commit 64bce29; only the UI wire is missing. Host = `apps/admin/src/class-workspace.tsx`.
- Casts (M6 — corrected inventory): **15 occurrences across 6 files** — `terms-panel.tsx` (1), `payroll-panel.tsx` (1), `compensation-panel.tsx` (1), `kpi-evaluation-panel.tsx` (1), `shift-reg-detail-panel.tsx` (4), `checkin-panel.tsx` (7, on a tRPC query result `:141-156` — was MISSING from the original inventory). Replace with the typed `AppRouter` tRPC client so end-to-end type-safety holds. NOTE: `payroll-panel.tsx`/`compensation-panel.tsx` are ALSO edited in P5 (forms) → serialize with P5 to avoid conflict.
- `lmsAuth.loginParent` (`lms-auth.ts:36-48`) uses `loginParent` from `@cmc/auth` (`packages/auth/src/lms.ts`). GitNexus: `loginParent` fn is called by `lms-auth.ts` AND `guardian-principal-isolation.int.test.ts`. No LMS frontend caller (grep clean). Deleting the procedure is safe UI-wise; the underlying fn is still exercised by the isolation test.
- `/showcase` LMS route is all-mock but reachable in prod (brainstorm §1.3).

## Requirements
1. Wire `classBatch.update` into `class-workspace.tsx` edit form (backend/perms/tests exist — UI only). Use `@cmc/ui` notify/validators.
2. Replace all 15 `as any`/`as unknown as` tRPC casts across the 6 panels (incl. `checkin-panel.tsx` ×7) with the typed client. Run typecheck after EACH file (brainstorm §5: casts may hide latent type drift).
3. Delete `loginParent` procedure from `lms-auth.ts:36-48` + remove now-unused `loginParent` import (`lms-auth.ts:4`). **RESOLVED (operator 2026-07-02): also REMOVE the `@cmc/auth` `loginParent` fn** — parent login is OTP-by-email only; migrate `guardian-principal-isolation.int.test.ts` to authenticate via the OTP/`parentSession` path so isolation coverage reflects the real prod flow. Student login (`loginStudent`, account born at receipt.approve) is untouched — verified correct against the operator's design (account keyed to Student, survives class changes, idempotent).
4. Gate `/showcase`: DEV-only (env flag / build-time guard) so it is unreachable in prod.
5. Record deferred backend-ready procedures (badge admin, shift withdraw, room update, etc. — brainstorm §1.2/§4 W3) in a `DEBT.md` (do NOT implement this round).

## Architecture
- Typed client: import `AppRouter` type into the tRPC client setup consumed by panels; remove per-call casts. No runtime change — compile-time safety only.
- `/showcase`: guard the route registration behind `import.meta.env.DEV` (or the app's env flag) so prod bundle omits/blocks it.

## Related code files
- `apps/admin/src/class-workspace.tsx` — classBatch.update form.
- `apps/admin/src/{terms,payroll,shift-reg-detail,kpi-evaluation,compensation,checkin}-panel.tsx` — de-cast (payroll/compensation shared with P5; checkin has 7 casts at `:141-156`).
- `apps/api/src/routers/lms-auth.ts:4,36-48` — delete procedure + import.
- `packages/auth/src/lms.ts` — `loginParent` fn (RESOLVED: remove; migrate isolation test to OTP path).
- `apps/api/test/guardian-principal-isolation.int.test.ts` — update if fn removed.
- LMS router/route registration for `/showcase`.

## Implementation Steps
1. Wire classBatch.update form; typecheck admin.
2. De-cast each panel one at a time; typecheck after each; fix any revealed type mismatch.
3. Delete loginParent procedure + import; decide fn fate; update isolation test if removing fn.
4. Gate /showcase DEV-only; verify prod build excludes it.
5. Create DEBT.md listing deferred procedures.

## Todo list
- [ ] classBatch.update wired into class-workspace edit UI
- [ ] 15 casts removed across 6 panels (incl. checkin ×7); typecheck clean per file
- [ ] loginParent procedure + import deleted; fn decision resolved; isolation test updated
- [ ] /showcase DEV-only gate
- [ ] DEBT.md for deferred backend-ready procedures

## Success Criteria
- Class edit UI updates a batch via `classBatch.update`.
- `grep -r "as any\|as unknown as"` in the 6 panels returns 0 around tRPC calls; `pnpm typecheck` green.
- `lmsAuth.loginParent` gone; OTP login still works; isolation test green.
- `/showcase` unreachable in a prod build.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| De-casting reveals real type mismatch in a panel | Med | Med | Typecheck per file; fix the mismatch (do not re-cast); these are the bugs the casts hid. |
| Removing loginParent fn breaks isolation test coverage | Med | Med | Migrate test to OTP path (operator-resolved); test must still prove cross-guardian isolation before fn removal lands. |
| payroll/compensation panel edit collides with P5 | High | Low | Serialize P6 de-cast of those two panels after P5 form wiring (same files). |

## Security Considerations
- Deleting loginParent removes a password-based LMS login path that contradicts the passwordless-OTP decision — reduces attack surface (no account-enumeration/credential-stuffing on that route).
- /showcase gate prevents mock surface exposure in prod.

## Next steps
- Rollback: revert per-file from git; restore loginParent from history if OTP regression found. Feeds P7 typecheck/e2e.
