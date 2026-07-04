# Phase 2 — ERP reset-to-default UI (student + parent admin)

Status: pending · Depends: P1 (endpoints `guardian.resetFamilyPassword` +
`student.resetLmsPassword` already ship in P1). Owns: `apps/admin/src/student-detail.tsx` (+ the
parent admin detail surface) + component/e2e. **No router edits here** (P1 owns them) → disjoint
from P3.

## Goal

Wire the ERP-side reset UIs to the endpoints authored in P1, full-stack and confirm-only.

## Two reset surfaces (decision 0032 D6)

- **Student detail** (existing `LmsAccountSection`, `student-detail.tsx:117-174`, calls
  `trpc.student.resetLmsPassword` at `:127`): resets the child's break-glass `loginStudent`
  credential to `Cmc2026@`. Update copy + the reveal to show the fixed default (no longer a random
  secret); keep the confirm interaction.
- **Parent admin detail** (the surface listing a ParentAccount — confirm host via
  `guardian.parentList`/parent-detail component; scout `apps/admin` for it): add a "Đặt lại mật
  khẩu đăng nhập gia đình" confirm button → `trpc.guardian.resetFamilyPassword({ parentAccountId
  })`. This is the PRIMARY family login reset. No input field; confirm-only; after success show
  "Mật khẩu đã đặt lại về Cmc2026@".

## Requirements

- Both buttons are confirm-gated (existing confirm pattern), disabled while pending, surface
  success/error via the app's notify convention.
- Copy must make the two-credential distinction clear so staff relay the right thing: family
  login = parent phone + `Cmc2026@`; break-glass = the child's `loginCode` + `Cmc2026@`. The
  break-glass loginCode is the facility-prefixed `${facility.code}-${studentCode}` form (M1 —
  P1 aligns both creation paths to this so what staff relay is consistent + globally unique);
  surface that exact value in the reveal.
- No secret is "revealed once" anymore — the password is a known constant; render it as static
  helper text, not a one-time reveal modal (avoids implying it is secret).

## Files

- Modify: `apps/admin/src/student-detail.tsx` (`LmsAccountSection` copy + reveal → fixed default).
- Modify/confirm: the parent admin detail component (grep `apps/admin` for the ParentAccount
  detail/edit surface; if none exists, add the button to the parent list row action — scope it in
  P2 scouting, keep KISS).
- Test: extend `apps/admin`/e2e coverage OR an int test asserting the button calls the endpoint
  and the endpoint result path.

## Implementation steps

1. `gitnexus_impact` on `resetLmsPassword` + `student-detail.tsx LmsAccountSection` (upstream).
2. Scout the parent admin detail host (`guardian.parentList` consumers).
3. Update student-detail copy/reveal; add the parent-detail reset button.
4. Wire both to the P1 endpoints; loading/confirm/notify states.

## Tests

- Component/e2e: student-detail reset button triggers `student.resetLmsPassword`; parent-detail
  button triggers `guardian.resetFamilyPassword`; both render success copy.
- (The non-vacuous DB assertion lives in P1 test #7; here we verify the UI→endpoint wiring, not
  re-test the DB effect.)

## Risks / rollback

- Risk: LOW-MED (UI wiring to existing gated endpoints). Wrong host for the parent reset button is
  the main risk → resolved by P2 scouting before edit.
- Rollback: revert the admin component commits; endpoints (P1) unaffected.

## Done =

Both reset buttons wired + confirm-gated + correct copy; code-review clean; gitnexus
`detect_changes` scope = admin files only; e2e/live shows ERP reset → family re-login with
`Cmc2026@`.
