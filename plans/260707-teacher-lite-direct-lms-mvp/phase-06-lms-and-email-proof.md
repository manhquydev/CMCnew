# Phase 6: LMS and Email Proof

## Goal

Prove Teacher Lite-created families work in LMS.

## Requirements

- Parent email OTP works.
- Student parent-phone + `Cmc2026@` works.
- Profile picker works for siblings.
- Student sees homework and submits.
- Parent sees published evidence/grades/stars.
- Email outbox routes parent mail externally.
- Phone/default-password path never mints parent session.
- Email proof must not depend on plaintext body after terminal send because secret templates are scrubbed.

## Tests

- LMS auth integration.
- Submission integration.
- Parent visibility integration.
- Playwright LMS smoke.
- Email outbox assertion without printing secrets.
- Negative test: phone login cannot call parent-only mutation.

## Implementation Proof

- Direct Teacher Lite provisioning queues `lms_account_ready` email with deterministic dedup key.
- Direct Teacher Lite provisioning creates/updates:
  - parent account by normalized phone/email,
  - student account with login code,
  - guardian link,
  - active enrollment,
  - default student LMS password path.
- Decision `0033` remains enforced by existing auth: phone/default password logs into the student profile picker, not a parent session.

## Validation

- `pnpm --filter @cmc/lms typecheck`: passed.
- `pnpm --filter @cmc/lms build`: passed with Vite chunk-size warning.
- `pnpm --filter @cmc/api exec vitest run test/lms-security-invariants.int.test.ts test/session-evidence-publish-to-lms.int.test.ts`: passed with DB soft-skip in local environment.
- `pnpm --filter @cmc/api exec vitest run test/teacher-lite-direct-provisioning.int.test.ts`: passed with DB soft-skip in local environment.

## Blocked Proof

- Full LMS auth/email/submission proof needs reachable Postgres. Harness registry reports no present `database` or `docker` capability, so this local run cannot create the DB-backed proof.
