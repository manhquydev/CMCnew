# 0031 Staff password login runs permanently alongside SSO

Date: 2026-07-03

## Status

Accepted

## Context

The original design (decision-era architecture, `apps/api/src/routers/auth.ts`) made staff
password login fail-closed: only `super_admin` could ever log in with a password; every other
staff member was SSO-only via Microsoft Entra, gated by `STAFF_PASSWORD_LOGIN` (unset/false in
prod). This was documented in `docs/prod-deploy-security-runbook.md` as "never set in prod."

A red-team review of a persona-QA testing plan (`plans/260703-1013-persona-qa-ux-audit/`)
surfaced that this fail-closed design blocks even legitimate operator needs: there was no way to
create a working staff test account without a real Entra mailbox, and no staff password
set/reset endpoint existed at all — `user.create` sets an unknowable random `passwordHash` with
no way to recover it.

Operator decision: password login should run **permanently alongside SSO** in production — not
as a temporary QA-only toggle — to support both QA/test tooling and real day-to-day operational
flexibility (e.g. recovering access when SSO is unavailable).

## Decision

- `STAFF_PASSWORD_LOGIN=true` is set permanently in prod's `.env.production`. SSO remains the
  default onboarding path (unchanged); password login is an additional, always-available path
  for any staff account that has had a password set.
- New `user.setPassword` mutation (`apps/api/src/routers/user.ts`, `superAdminProcedure`-gated)
  lets `super_admin` set/reset any staff account's password. Mirrors
  `student.resetLmsPassword`'s pattern: generates a random temp password, hashes it, bumps
  `tokenVersion` (invalidates existing sessions), returns the plaintext password **once** —
  never stored, caller relays it out-of-band. Sends a security-alert email to the account holder.
- A staff account has no usable password until `user.setPassword` is explicitly called for it —
  accounts onboarded via SSO only (the common case) have no known password and stay
  SSO-only in practice, even though the global gate is open.
- No self-service "forgot password" flow yet (YAGNI — `super_admin`-set is sufficient for the
  current small staff count; revisit if that becomes a bottleneck).

## Consequences

- `docs/prod-deploy-security-runbook.md`'s "never set `STAFF_PASSWORD_LOGIN` in prod" guidance is
  superseded by this decision — updated in the same change.
- Any staff account with a set password becomes a password-guessable target (mitigated by
  existing login rate-limiting in `apps/api/src/rate-limit.ts` — unchanged) — this is an accepted
  trade-off for operational flexibility, not an oversight.
- Enables the persona-QA plan's staff personas to authenticate via `super_admin`-issued
  passwords instead of requiring real SSO test mailboxes.
