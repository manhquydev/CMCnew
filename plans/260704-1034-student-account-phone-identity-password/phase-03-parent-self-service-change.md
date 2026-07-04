# Phase 3 — LMS phone-login screen + profile picker + parent self-service change UI

Status: pending · Depends: P1 (endpoints `loginFamilyByPhone`, `enterChildProfile`,
`changeFamilyPassword` all ship in P1). Owns: `packages/ui/src/lms-login-gate.tsx`,
`apps/lms/src/parent-view.tsx` + e2e. **No router edits here** (P1 owns them) → disjoint from P2.

## Goal

Replace the LMS "Học sinh" loginCode field with the phone-login + Netflix profile picker, and add
the parent self-service family-password change form — full-stack, wired to P1 endpoints.

## A. Login gate — `packages/ui/src/lms-login-gate.tsx`

Current: "Học sinh" tab (`:391-441`) collects `loginCode` + password → `lmsAuth.loginStudent`
(`:113`). New behavior:

1. **Phone-login form** (repurpose the "Học sinh" tab): fields = parent phone + password
   (default hint `Cmc2026@`). Submit → `trpc.lmsAuth.loginFamilyByPhone({ phone, password })` →
   returns `{ ticket, children }`. Hold the `ticket` in local state ONLY (it is not a cookie /
   not a session — B1); NO parent session is established at this step.
2. **Auto-enter (1 child):** if `children.length === 1` → immediately `trpc.lmsAuth
   .enterChildProfile({ ticket, studentId: children[0].id })` → `me()` → principal resolves to
   student → gate renders `children` (StudentShell). No picker shown.
3. **Profile picker (2+):** set local state `{ familyChildren, ticket }` and render a picker view
   (tiles: avatar placeholder + `fullName`). Tap a tile → `enterChildProfile({ ticket, studentId })`
   → `me()` → student view. Include a "Đăng nhập lại" / back affordance (clears the held ticket +
   state — no `logout` needed since no cookie was set until a child is entered).
4. Keep the **Phụ huynh** email-OTP tab 100% unchanged (`:286-388`). Update the "Học sinh"
   segment label/help text to "Đăng nhập bằng SĐT phụ huynh".
5. Error copy: invalid phone/password → generic "Sai SĐT hoặc mật khẩu" (no enumeration).
   Expired ticket (>~5 min on the picker) → "Phiên chọn hồ sơ đã hết hạn, đăng nhập lại".

State: the picker lives in the gate's `principal === null` branch and holds only the client-side
ticket (no cookie yet); the FIRST cookie is set by `enterChildProfile`, which mints a
`kind:'student'` session — so `me()` then returns a student principal and the gate renders
children. Switching child = "Đổi hồ sơ" → `logout()` → back to phone-login (the cookie is now a
student token). B1: no `kind:'parent'` cookie is ever created on this path.

## B. Parent self-service change — `apps/lms/src/parent-view.tsx`

Host = `ProfileTab` (`:398-519`, already does `guardian.profileUpdate`/`requestLink`). Add a
"Đổi mật khẩu đăng nhập gia đình" card:

- Single `PasswordInput` (new password) + confirm; NO old-password field.
- Submit → `trpc.guardian.changeFamilyPassword({ newPassword })`. On success, the family
  `tokenVersion` bumps → the current parent session is invalidated on the next request; show
  "Đổi mật khẩu thành công, vui lòng đăng nhập lại" and call `logout`.
- This is a PARENT-portal (email-OTP) surface — the parent is authenticated as `kind:'parent'`,
  so `changeFamilyPassword` (parentProcedure, keyed on `ctx.lms.accountId`) targets their own
  family credential only. No child selector needed (one password per family).

Note: the family password is shared with the phone-login path, so a parent who changes it here
must relay the new password to the child for phone-login. Card copy should say so.

## Files

- Modify: `packages/ui/src/lms-login-gate.tsx` (phone-login + picker; keep OTP tab).
- Modify: `apps/lms/src/parent-view.tsx` (`ProfileTab` change card).
- Test: `apps/e2e/tests/` — new spec (pattern from `lms-autosave-and-parent-readonly.spec.ts`,
  which builds an LMS session via `hashPassword`/`mintParentSession`).

## Implementation steps

1. `gitnexus_impact` on `LmsLoginGate` + `ProfileTab` (upstream consumers — App.tsx, both apps).
2. Build the phone-login form + picker state machine in the gate.
3. Add the ProfileTab change card.
4. E2E: provision → phone-login → (1-child auto-enter) student view; multi-child → picker → pick
   → student view; parent OTP login → change password → forced re-login.

## Tests (e2e / component)

- Phone-login single child → lands directly in StudentShell (no picker).
- Phone-login 2 children → picker with 2 tiles → tap → StudentShell for that child.
- Cross-family safety is covered at the API layer (P1 test #5); the UI e2e asserts a parent only
  ever sees their own children as tiles.
- Parent OTP → ProfileTab change → success + logout → re-login with the new password works, old
  fails.
- Email-OTP parent login still works unchanged (regression guard).

## Risks / rollback

- Risk: MED (login gate is the entry point for BOTH apps — a regression locks everyone out).
  Mitigation: keep the OTP tab code path untouched; e2e regression guard on parent OTP; the
  break-glass `loginStudent` endpoint stays available if the phone-login UI misbehaves.
- Cookie subtlety (B1): before `enterChildProfile` there is NO cookie (only the client-held
  ticket); `enterChildProfile` sets the first cookie as a `kind:'student'` token. Verify `me()`
  after the call returns `kind:'student'` and that no `kind:'parent'` cookie is ever set on this
  path (no stale parent principal in gate state).
- Rollback: revert the gate + parent-view commits; endpoints (P1) unaffected; the old loginCode
  login still functions if needed as an interim.

## Done =

Phone-login + picker + auto-enter working; parent change card wired; email-OTP path unregressed;
code-review clean; gitnexus `detect_changes` scope = ui + lms files only; e2e green.
