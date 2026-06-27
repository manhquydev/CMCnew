# Phase 02 — Account provisioning emails (parent LMS + staff onboarding)

**Goal:** When a parent LMS account or a staff account is created, deliver login access by email —
using a **passwordless one-time activation link** (research §H.1) instead of mailing a raw password.

**Depends on:** Phase 01. **Risk:** Auth (account access).

## The provisioning gap (from audit)

- Parent login = `ParentAccount` (`email?` unique, `phone?`). Created at
  `apps/api/src/routers/guardian.ts:24–48` (`parentCreate`) — password set by staff, **never delivered**.
- Enrollment at `apps/api/src/routers/enrollment.ts:51–129` (`enroll`) is where a CRM opportunity
  converts to a real student; this is the natural moment to ensure the parent has LMS access.
- Staff login = `AppUser` (`email` required+unique). Created at `apps/api/src/routers/user.ts:46–83`
  (`create`) — password set by admin, **never delivered**.

## Activation-token model (new)

```prisma
enum ActivationKind { parent_account staff_account password_reset }   // shared with Phase 04

model ActivationToken {
  id          String         @id @default(uuid()) @db.Uuid
  kind        ActivationKind
  subjectType String         @map("subject_type")   // 'parent' | 'staff'
  subjectId   String         @map("subject_id") @db.Uuid
  tokenHash   String         @unique @map("token_hash")  // store SHA-256 of token, never the raw token
  expiresAt   DateTime       @map("expires_at")
  consumedAt  DateTime?      @map("consumed_at")
  createdAt   DateTime       @default(now()) @map("created_at")
  @@index([subjectType, subjectId])
  @@map("activation_token")
}
```

- Raw token = 32 random bytes, base64url; only its SHA-256 hash is stored. TTL = 24h (activation),
  configurable. Single-use (`consumedAt`). The activation URL points at the relevant frontend
  (`{APP_ORIGIN}/activate?token=…`), origin from env.

## Work items

1. **Service** `apps/api/src/services/account-activation.ts`:
   `issueActivation(tx, { kind, subjectType, subjectId, email })` → creates token, returns raw token
   + calls `enqueueEmail(tx, …)` with template `parent_welcome` / `staff_welcome`.
2. **guardian.ts `parentCreate`**: after creating `ParentAccount`, if `email` present →
   `issueActivation(...)` in the same txn. If `email` null → skip (log, no error).
3. **enrollment.ts `enroll`**: ensure the student's parent has a `ParentAccount`; if newly linked
   and has email and no prior activation → `issueActivation`. (Confirm the guardian-link path with
   `guardian.ts` `link`/`parentCreate` before wiring — keep idempotent so re-enroll doesn't re-mail.)
4. **user.ts `create`**: after creating `AppUser` → `issueActivation(kind:staff_account)` to
   `AppUser.email` via the `hr` mailbox.
5. **Endpoints** (new in `auth.ts` / `lms-auth.ts`): `activate.verify(token)` → returns subject +
   validity; `activate.setPassword(token, newPassword)` → consumes token, sets password hash, bumps
   `tokenVersion`. Rate-limit via existing `rate-limit.ts`.
6. **Templates**: `parent_welcome`, `staff_welcome` (Vietnamese; link, expiry, support contact).
7. **Minimal UI**: an `/activate` route in `apps/lms` (parent) and `apps/admin` (staff) — token from
   query, password form, calls the endpoints. Reuse existing form components from `packages/ui`.

## Tests
- `parentCreate` with email → 1 `ActivationToken` + 1 `EmailOutbox(parent_welcome)`; without email → none.
- `activate.setPassword` consumes token, sets password, second use → `CONFLICT`/`expired`.
- Expired token rejected. Token stored hashed (assert raw token not in DB).
- `enroll` is idempotent: re-enrolling the same student does not issue a second activation.

## Risks / rollback
- Touches account access → **must** preserve existing manual-password path (email is additive: if
  no email, behavior is exactly as today). Activation endpoints are new public contracts — document them.
- Rollback: remove activation issuance calls + token model; manual passwords still work.
