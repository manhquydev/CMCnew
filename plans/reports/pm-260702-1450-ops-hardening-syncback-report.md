# PM sync-back — Plan 7 ops-hardening (2026-07-02)

Status: implemented-pending-operator-verification. 3/5 phases fully done; 2 phases (P2, P3) code-done
with one operator-assisted checklist item each remaining (need VPS access, cannot be done by agent).

## Phase completion

| Phase | Code | Test/Review | Operator step remaining |
|---|---|---|---|
| P1 logging+alert | done | tester+reviewer PASS | none |
| P2 backup/restore | done | tester+reviewer PASS | install cron + run real drill on VPS |
| P3 Jenkins PR gate | done | tester+reviewer PASS | confirm red-PR demo on live Jenkins |
| P4 ESLint RLS guard | done | tester+reviewer PASS | none |
| P5 docs hygiene | done | tester+reviewer PASS | none |

## Verification

- `pnpm -r typecheck`: 0 errors (13 projects)
- `pnpm lint`: 0 new errors (2 pre-existing unrelated warnings unchanged)
- `apps/api test:integration`: 410/410 pass
- code-reviewer verdict: SHIP (2 medium suggestions, 1 applied: error-alert.ts retry-safety fix)

## Decisions locked this session

- No Sentry — pino + email-outbox alert only (operator: PII egress concern).
- 3 old prod-readiness plans (0133/0949/1413) NOT superseded — current erp+hoc.cmcvn.edu.vn is an
  interim/test deployment; real prod redeploy happens after all 6 plans in this pipeline ship.

## Unresolved

- Operator must run the 2 blocked-on-operator checklist items (P2 drill, P3 red-PR demo) whenever VPS
  access is convenient — not blocking the rest of the 6-plan pipeline.
