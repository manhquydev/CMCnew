---
title: "Validate/finalize — 4-plan red-team outcomes + final state (UX / date-time / student-auth / nav-IA)"
date: 2026-07-04
type: validate-report
status: all 4 plans finalized (Brainstorm → Plan → Red-team → Validate → normalized); implementation NOT started (out of scope this session)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
brainstorm_source: plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
---

## What this session produced

4 independent, phase-split plans (no implementation — explicit user scope). Each went through the
full loop: author (planner) → adversarial red-team (code-reviewer vs real code) → user-validated
key decisions → normalize (fold fixes). Plan C additionally pivoted design mid-cycle and got a
SECOND red-team on the new model. Every red-team verified claims against live code with file:line
citations, not plan text.

## The 4 plans (final locations)

| Plan | Dir | Lane | Phases | Red-team verdict (final) |
|---|---|---|---|---|
| **A — UX correctness quick-fixes** | `plans/260704-1034-ux-correctness-quickfixes/` | tiny/normal | 1 (3 atomic fixes) | 0 blocking; 1 tz should-fix folded |
| **B — Date/time picker rollout** | `plans/260704-1034-datetime-picker-rollout/` | normal | P0 helper + P1-P4 by screen-group | 0 blocking; 4 should-fix folded (TZ-pin test is the key one) |
| **C — Student account phone-identity + password** | `plans/260704-1034-student-account-phone-identity-password/` | **high-risk (Auth)** | P0 → P1 → {P2 ‖ P3} | pivoted + re-red-teamed; 1 CRITICAL blocking (B1 privilege-escalation) found+fixed |
| **D — Nav module + sub-tab IA** | `plans/260704-1034-nav-module-subtab-ia/` | **high-risk (cross-cutting)** | P0 design → P1 mechanism → P2-P4 clusters → P5 retire+regress | 2 blocking + 3 extra matrix bugs found+fixed |

## Red-team catches that mattered (why the loop paid off)

- **Plan C B1 (CRITICAL, 2nd red-team on the new model)** — the re-authored Netflix-profile login minted
  a full `kind:'parent'` session from phone + the public default password `Cmc2026@`. Because
  `guardian.profileUpdate` can rewrite the parent email and Email-OTP login resolves by email, anyone
  knowing a parent's phone (printed on receipts) + the default could take over the parent's *stronger*
  Email-OTP account and lock them out. The new model was **worse than the old one** on the parent-portal
  attack surface. **Fixed**: phone-login now returns a short-lived signed child-selection ticket (no
  parent-capable cookie); `enterChildProfile` consumes it and only then sets the student cookie; P1 tests
  #11/#12 assert a phone-login principal is FORBIDDEN at every `parentProcedure` mutation and unusable as
  an LMS cookie. This is the single most valuable finding of the session — it would have shipped a real
  account-takeover vector.
- **Plan C (1st red-team, old suffix model)** — the per-child `84xxx-N` suffix allocation did a
  catch-P2002-and-retry INSIDE the receipt.approve transaction, which is impossible on Postgres
  (unique_violation aborts the whole tx) → concurrent sibling approval would roll back the money flow.
  This is what drove the pivot to the profile-picker model (user-chosen).
- **Plan C S1 (2nd red-team)** — the pivot's "no unique race" claim was still FALSE at the
  `ParentAccount.phone` level (findFirst-then-create on a @unique column). **Fixed**: documented residual
  race + `ON CONFLICT DO NOTHING`/savepoint handling + a concurrent-new-sibling integration test.
- **Plan D B1 + re-audit** — the plan's per-role visibility matrix had a factual error (giao_vien-only
  actually sees 2 subtabs of giang-day, not 1). The mandated full re-audit found **3 MORE** matrix errors
  (giao_vien also sees crm-kinh-doanh→badges; hr role does NOT see nhan-su→hr) and surfaced a
  **pre-existing latent 403** (`defaultSection` lands the `hr` role on a section its own gate forbids).
  An implementer trusting the wrong matrix could have hidden screens from roles that should see them.
  **Fixed** matrix; pre-existing hr-role bug flagged for separate intake (below).
- **Plan D B2** — dual source of truth (a standalone MODULES.subtabs list vs buildNavGroups already
  encoding membership); the drift-guard only caught missing sections, not mis-placed ones. **Fixed**: derive
  module membership FROM buildNavGroups (one source of truth).
- **Plan D S4** — the plan told the implementer to rewrite the 4 nav-*.test.ts suites; that invites
  regression-masking. **Fixed**: those suites must pass BYTE-FOR-BYTE UNCHANGED as the parity gate; only
  ADD the new mapping-derivation guard.
- **Plan B S4** — the P0 round-trip helper test passes even with a broken UTC helper when CI runs in UTC.
  **Fixed**: pin `TZ=Asia/Ho_Chi_Minh` so the test actually locks the timezone contract.

## User-validated key decisions (2026-07-04)

- **C**: pivoted to **Netflix-style family profile picker** — login = parent phone `84xxx` (no `+`), ONE
  credential per phone (reuses `ParentAccount.passwordHash`, **no migration**), default `Cmc2026@`; 1 child
  auto-enters, 2+ shows a picker; no per-child PIN; parent self-service change (no old pw) + ERP reset-to-default.
- **D**: single-visible-subtab module rail shows the **module** label (uniform), accepted discoverability
  tradeoff; keep flat `/{sectionKey}` URL (Option C) so search deep-links stay intact; all-8-modules in one plan.
- **A**: status Select = action-picker (Option B), StatusBadge stays source of truth.
- **B**: single plan, phases by screen-group; terms-panel native-date deferred; assessment-panel L1-label field excluded.

## Recommended build order

**A → B → C → D** (ascending risk; D last so its routing rewrite absorbs the final state). A/B/C are
independently shippable. D's routing (Option C, keep flat URL) is compatible with the search deep-link +
opportunity deep-link shipped in the prior re-skin session by construction.

## Open items carried forward (NOT blocking the plans; for a later session)

1. **Plan C B1 implementation shape** — child-selection ticket (recommended, smaller blast radius) vs a
   restricted `kind:'family'` union member that `parentProcedure` rejects. Final choice at P1
   implementation; the security invariant + tests are mandatory either way.
2. **Plan C cascade-on-reset** — default is NO cascade to already-entered child student sessions (≤12h);
   acceptable because reset DOES evict the higher-value parent/family session. Confirm at P1 if desired.
3. **Plan D pre-existing hr-role bug (separate intake)** — `defaultSection` lands the `hr` role on a
   section its `payroll.roster` gate forbids (latent 403 in TODAY's flat nav, not introduced by Plan D);
   and the `hr` role sees very little under `nhan-su` (only my-payslips). These are permissions-registry
   questions, not nav-IA — recommend a separate intake to decide the hr-role landing + nhan-su scope.

## Status

All 4 plans finalized and internally consistent. Implementation is a separate effort (this session's
scope was plans only). Each plan carries a full harness loop per phase (implement → code-review →
gitnexus audit → live-verify → commit) and DB/live-verifiable acceptance criteria, consistent with the
prior re-skin plan's conventions.
