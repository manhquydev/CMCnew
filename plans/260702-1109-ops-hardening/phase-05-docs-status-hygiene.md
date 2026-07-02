# Phase 5 — Docs / status hygiene + .env.example sync

## Context links
- Report §"PLAN 7" item 5: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md:47`
- Roadmap stale marker: `docs/roadmap.md:33` (session-evidence `⬜ pending` — actually shipped 3d6db9d)
- TEST_MATRIX: `docs/TEST_MATRIX.md:87` (LMS-SESSION-EVIDENCE row)
- Story validation: `docs/stories/LMS-SESSION-EVIDENCE/validation.md`
- Debt: `DEBT.md` (payroll director-read at `:13`, unresolved Q at `:23`)
- Env: `.env.example` (missing several read vars)

## Overview
Docs claim work that shipped is still pending, and `.env.example` omits env vars the code reads. Pure documentation
hygiene — no code change. Bring roadmap/TEST_MATRIX/plan-statuses/DEBT/env in line with the shipped reality.

## Key Insights
- **Verified shipped commits** (git log): session-evidence = `3d6db9d`; hr-role-consolidation = `27849d3`;
  teacher-nav e2e fix = `26dc955`. Use these SHAs when flipping statuses.
- **`.env.example` gap (verified via grep of `process.env.*` in `apps/api/src`):** missing `STAFF_PASSWORD_LOGIN`
  (auth.ts:34), `DISABLE_CRON` (index.ts:385), `LOGIN_RATE_PAIR_LIMIT`/`LOGIN_RATE_IP_LIMIT`/`LOGIN_RATE_WINDOW_MS`
  (rate-limit.ts:23-26), `LEAD_RATE_IP_LIMIT` (crm.ts:23), `OTP_RATE_LIMIT` (lms-auth.ts:10), `PDF_STORE_DIR`
  (pdf-store.ts:9), `SESSION_PHOTO_STORE_DIR` (photo-store.ts:19). That's STAFF_PASSWORD_LOGIN + DISABLE_CRON + 7
  rate-limit/store vars. Also fold in P1's new names (LOG_LEVEL, ERROR_ALERT_THRESHOLD, optional SENTRY_DSN).
- **DEBT close:** `DEBT.md:13` payroll director-read is intentional per Plan 3 Decision B (facility-wide read, only
  writes domain-scoped) → move from "gap" to a closed/decided note; keep the long-term Q at `:23` or resolve it.
- **Plan-status ambiguity:** report says "260626 prod-readiness ×2" but three exist — list all three, mark
  superseded-by-260628-0147, flag for operator (see plan.md Unresolved).

## Requirements
- `docs/roadmap.md:33`: session-evidence `⬜ pending` → shipped (cite `3d6db9d`).
- `docs/TEST_MATRIX.md`: LMS-SESSION-EVIDENCE planned → implemented.
- `docs/stories/LMS-SESSION-EVIDENCE/validation.md`: reflect implemented state if it still says planned.
- Plan statuses:
  - `plans/260701-1906-hr-role-consolidation/plan.md`: in-progress → shipped (`27849d3`)
  - `plans/260701-1910-teacher-nav-lich360-consolidation/plan.md`: implemented-pending-e2e → e2e fixed (`26dc955`)
  - `plans/260626-0133-erp-prod-readiness`, `plans/260626-0949-full-prod-readiness`, `plans/260626-1413-prod-readiness-completion`: mark superseded-by-`260628-0147-prod-deployment` (flag ×2-vs-×3 for operator)
  - `plans/260701-1223-lms-climb-session-lock/plan.md`: superseded-by-`260702-0929-lms-erp-seam-fixes` (Plan 1)
- `DEBT.md`: close payroll director-read per Plan 3 Decision B; add new debt items surfaced by the report (e.g. off-box backup copy, e2e-on-PR deferral, unit-test coverage gap).
- `.env.example`: add the 9 missing vars above (+ P1 names) with short comments; keep the inert-until-set convention wording.

## Related code files
- MODIFY `docs/roadmap.md`, `docs/TEST_MATRIX.md`, `docs/stories/LMS-SESSION-EVIDENCE/validation.md`
- MODIFY `DEBT.md`
- MODIFY `.env.example`
- MODIFY (status-only) the 6 plan.md files listed above

## Implementation Steps
1. Flip roadmap/TEST_MATRIX/validation markers with commit citations.
2. Update the 6 plan statuses; use `ck plan check`/status field or edit frontmatter `status:` directly.
3. Rewrite the `DEBT.md` payroll line as a closed decision; append new debt items.
4. Append missing env vars to `.env.example` with comments; group under existing section headers (Auth, rate-limit, storage).
5. Re-grep `process.env.` in `apps/api/src` after editing to confirm no read var is still undocumented.

## Todo list
- [ ] roadmap session-evidence → shipped (3d6db9d)
- [ ] TEST_MATRIX + story validation → implemented
- [ ] 6 plan statuses updated (with supersede pointers)
- [ ] DEBT.md: close payroll director-read + add new items
- [ ] .env.example: +9 vars (+P1 names), re-grep confirms complete
- [ ] Flag 260626 ×2-vs-×3 to operator

## Success Criteria
- No `⬜`/planned marker remains for session-evidence in roadmap or TEST_MATRIX.
- Every `process.env.X` read in `apps/api/src` has a matching entry in `.env.example`.
- Superseded plans point to their successor; shipped plans cite the shipping commit.
- `DEBT.md` no longer lists payroll director-read as an open gap.

## Risk Assessment
- **Wrong supersede mapping (MED×LOW):** the ×2-vs-×3 ambiguity — mitigate by listing all three and tagging for operator confirmation rather than guessing.
- **Missing an env var (LOW×MED):** step 5 re-grep is the completeness check.
- **Editing another plan's file (LOW):** status-only edits; do not restructure other plans' bodies.

## Security Considerations
- `.env.example` must contain only placeholders/comments — never real secret values (esp. `JWT_SECRET`, `ENTRA_CLIENT_SECRET`, DB passwords). New entries follow the existing `""`/placeholder style.

## Next steps
- Pure docs; no verification beyond `pnpm -r lint` (docs untouched by lint) and the env re-grep. Merge with the other phases.
