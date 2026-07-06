---
date: 2026-07-06
topic: teacher-surface-scope-correction
story: TEACHER-CMCVN-LMS-BRIDGE
---

# Teacher Surface Scope Correction

## Context

The original teacher objective required a focused temporary system at `teacher.cmcvn.edu.vn` for teachers and directors, not a full ERP clone. User review correctly caught that the deployed experience still looked like ERP and exposed finance-like behavior.

## What Happened

- Restricted teacher surface routing/nav to teaching, class/material, student/parent, director coordination, and intake.
- Added `family-intake` as teacher-only route for parent+student draft handoff.
- Kept the backend handoff on existing `finance.receiptCreate`, but separated teacher UI copy from ERP Finance.
- Final correction made `family-intake` intake-only: no voucher, discount, prepay, or `Lập phiếu thu` wording on teacher surface.
- Rebuilt production admin; live asset is `/assets/index-fou0Ms-B.js`.

## Decisions

- `teacher.cmcvn.edu.vn` must feel like Teacher Console first, not ERP with renamed labels.
- ERP Finance remains the place for full receipt/price/voucher/reconcile work.
- Teacher intake can reuse receipt draft internals only if visible UI stays aligned to PH+HS intake.

## Verification

- Admin typecheck pass.
- Focused teacher/director nav tests pass: 21 tests.
- Admin build pass.
- Full teacher LMS bridge verifier pass: 13 Playwright tests plus API/UI/DB setup.
- Production live smoke pass: `CMC Teacher Portal`, asset `/assets/index-fou0Ms-B.js`, `family-intake` marker, valid Entra pre-login redirects.

## Next

- Close the only remaining evidence gap with a real production Microsoft MFA staff login if an operator account is available.

## Unresolved Questions

- None for local automated proof. Production post-MFA role proof still needs a real staff account.
