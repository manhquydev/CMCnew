# Phase 04 — Password reset + security alerts (NEW auth flow)

**Goal:** Build the password-reset flow that does not exist today, delivered by email; optionally
emit security-alert emails on sensitive account changes.

**Depends on:** Phase 01 (+ reuses the `ActivationToken` model from Phase 02, `kind:password_reset`).
**Risk:** ⚠️ **AUTH HARD GATE** — this is new authentication surface. Requires explicit confirmation
before implementation (per `docs/FEATURE_INTAKE.md`). Record a decision in `docs/decisions/`.

## Why it's its own phase
The audit confirms **no forgot-password exists** (`auth.ts` has only login/logout/me;
`packages/auth` has only `login()`/`resolveSession()`). Adding it expands the auth attack surface,
so it is isolated, gated, and shipped only after Phases 01–03 are green.

## Work items

1. **Endpoints** (new, unauthenticated, rate-limited via `rate-limit.ts`):
   - `auth.requestPasswordReset({ email })` — staff; `lms-auth.requestPasswordReset({ email })` — parent.
     Always returns success (no account enumeration). If the email matches → issue
     `password_reset` token (TTL 30 min, single-use, hashed) and `enqueueEmail` template
     `password_reset`. If no match → do nothing but return the same response.
   - `auth.resetPassword({ token, newPassword })` / `lms-auth.resetPassword` — verify token, set new
     password hash, consume token, bump `tokenVersion` (invalidates existing sessions).
2. **Throttling:** per-email + per-IP limit to prevent reset-spam (reuse rate-limit util).
3. **Template:** `password_reset` (Vietnamese; link, 30-min expiry, "ignore if not you" notice).
4. **UI:** `/forgot` + `/reset?token=…` routes in `apps/admin` (staff) and `apps/lms` (parent).
5. **Security alerts (optional, confirm scope):** on `user.ts setActive(false)` (deactivation) and
   `setRoles` (role change), enqueue an `account_security_alert` email to `AppUser.email`. Best-effort,
   non-blocking. Defer if user wants to keep v1 lean.

## Tests
- Unknown email → success response, **zero** tokens/emails created (no enumeration).
- Known email → 1 token + 1 `password_reset` email; token hashed in DB.
- `resetPassword` sets new hash, consumes token, bumps `tokenVersion` (old session invalid);
  reused/expired token → rejected.
- Rate limit triggers after threshold.

## Risks / rollback
- New auth endpoints = high blast radius. Mitigations: no enumeration, hashed single-use tokens,
  short TTL, session invalidation on reset, rate limiting, audit on every reset.
- Rollback: remove reset endpoints + UI; token model stays (also used by Phase 02). No existing
  login behavior changes.
