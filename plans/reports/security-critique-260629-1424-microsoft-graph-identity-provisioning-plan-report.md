---
title: "Security Critique: Microsoft Graph Identity Provisioning Plan"
date: 2026-06-29
lane: high-risk
status: completed
scope: advisory-review-no-implementation
reviewed_plan: ../260629-1409-microsoft-graph-identity-provisioning-hard-plan/plan.md
---

# Security Critique: Microsoft Graph Identity Provisioning Plan

## Summary

Plan direction is mostly sound: it correctly separates email Graph from identity Graph, blocks implementation before ADR, and keeps read-only diagnostic first.

Main security critique: the plan still needs stronger gates around Microsoft Entra role requirements, temporary password delivery, async outbox exposure, and offboarding scope. No source implementation should start until these are resolved.

Subagent note: attempted `code-reviewer` advisory subagent, but the agent stream failed with API `INTERNAL_ERROR`. I completed a direct evidence-backed review using local files + official Microsoft docs.

## Evidence Read

Local plan/docs/code:

- `plans/260629-1409-microsoft-graph-identity-provisioning-hard-plan/plan.md`
- `phase-01-evidence-and-decision-gates.md`
- `phase-02-read-only-graph-diagnostic.md`
- `phase-03-onboarding-design.md`
- `phase-04-deprovision-design.md`
- `phase-05-validation-and-go-live-gates.md`
- `plans/reports/hard-research-260629-1409-microsoft-graph-identity-provisioning-tenant-write-report.md`
- `docs/auth-sso-otp-redirection.md`
- `docs/decisions/0013-email-microsoft-graph-integration.md`
- `apps/api/src/routers/user.ts`
- `apps/api/src/services/email-outbox.ts`
- `packages/db/prisma/schema.prisma`

Official docs checked:

- Microsoft Graph create user: `POST /users`
- Microsoft Graph assign license: `POST /users/{id}/assignLicense`
- Microsoft Graph update user: `PATCH /users/{id}`
- Microsoft Graph revoke sessions: `POST /users/{id}/revokeSignInSessions`
- Microsoft Graph delete user: `DELETE /users/{id}`
- Microsoft Graph permissions overview
- Microsoft Entra app-only access primer
- Microsoft Entra Temporary Access Pass guide

## Findings

### F1 — High — Plan under-specifies Entra role requirements for sensitive app-only actions

**Evidence:**

- Plan Phase 04 lists Graph permissions for disabling account, revoking sessions, license removal: `phase-04-deprovision-design.md:31-38`.
- Microsoft `PATCH /users` docs say updating `accountEnabled` in app-only scenarios may require the app to be assigned a higher privileged administrator role, in addition to Microsoft Graph permissions.
- Microsoft `DELETE /users` docs say app-only `User.ReadWrite.All` is not enough for deleting privileged administrator users; app must be assigned higher privileged admin role for sensitive actions.

**Problem:**

The plan says permission facts, but does not make **Graph permission + Entra role** a hard gate. That can cause false confidence: admin consent alone may not prove the app can disable/delete certain accounts.

**Recommendation:**

Add a Phase 01 gate:

- Verify both Microsoft Graph application permissions and any required Microsoft Entra role assignment for each operation.
- Explicitly exclude privileged Microsoft admin accounts from automation.
- Add sandbox smoke test for a normal non-admin staff account only.

**Confidence:** High.

---

### F2 — High — Temporary password email should not be the default until TAP is decided

**Evidence:**

- Plan Phase 03 proposes `POST /users with temp password` then `enqueue temp credential email`: `phase-03-onboarding-design.md:32-42`.
- Microsoft `passwordProfile` docs say password is required when user is created, and strong password is required by default.
- Microsoft Temporary Access Pass docs say TAP is a time-limited passcode for onboarding passwordless methods and can be one-time use.
- Plan only lists TAP as an unresolved question in Phase 05: `phase-05-validation-and-go-live-gates.md:53-59`.

**Problem:**

Emailing a temporary password is a bigger secret-handling risk than needed if TAP is available and policy-enabled. The plan currently treats TAP as later optional research, not as a pre-implementation decision.

**Recommendation:**

Move TAP decision to Phase 01 hard gate:

- Option A: use passwordProfile temporary password + force change.
- Option B: create user then issue Temporary Access Pass.
- Option C: manual IT onboarding.

Do not implement temporary-password email until TAP feasibility is verified or explicitly rejected.

**Confidence:** Medium-high. TAP availability and exact Graph API permission path still need official API-specific verification before implementation.

---

### F3 — High — Async outbox can temporarily store plaintext credential unless design forbids it

**Evidence:**

- Existing `email-outbox.ts` stores rendered email `bodyHtml` when queued: `apps/api/src/services/email-outbox.ts:56-69`.
- Existing secret scrub only applies after terminal state and only for `otp_login` + `lms_account_ready`: `apps/api/src/services/email-outbox.ts:26-33`.
- Plan Phase 03 says enqueue temporary credential email after Graph create/license: `phase-03-onboarding-design.md:38-41`.
- Plan says email body scrubbed after terminal outbox state: `phase-03-onboarding-design.md:18-19`.

**Problem:**

If a new staff temporary credential email is queued using existing outbox style, the secret can sit in DB before send. Terminal scrub is not enough if DB is compromised during queue delay or if the worker is disabled.

**Recommendation:**

Add hard design rule before implementation:

- Prefer not to put temp password/TAP value into `email_outbox.body_html` at all.
- If email must carry secret, send synchronously and store only redacted audit; or create a special secret-bearing delivery path with immediate send + no durable plaintext body.
- If using outbox anyway, add new template kind to secret scrub list and cap TTL, but treat this as weaker.

**Confidence:** High.

---

### F4 — Medium — `separate Entra app is mandatory` is a good security policy, not a Microsoft fact

**Evidence:**

- Phase 01 says separate Entra app registration is mandatory: `phase-01-evidence-and-decision-gates.md:16-19`.
- Microsoft app-only docs say app-only permissions are powerful and admin-consented, but do not require separate app registration per function.

**Problem:**

The conclusion is correct as local risk control, but the plan should label it as **CMCnew security policy**, not Microsoft platform requirement. This avoids overclaiming.

**Recommendation:**

Change wording in plan/ADR:

- “CMCnew requires separate app registration to reduce blast radius.”
- Not: “Microsoft requires separate app.”

**Confidence:** High.

---

### F5 — Medium — Read-only diagnostic must prevent accidental write consent, not only avoid write calls

**Evidence:**

- Phase 02 says no write calls, only token + `GET /subscribedSkus`: `phase-02-read-only-graph-diagnostic.md:13-18`.
- Phase 02 risk says diagnostic accidentally gets write permissions: `phase-02-read-only-graph-diagnostic.md:57-60`.

**Problem:**

Avoiding write calls is not enough. If IT grants write app roles during read-only diagnostic, the app credential already has write blast radius.

**Recommendation:**

Add evidence gate:

- Capture redacted app permission list before diagnostic.
- Fail diagnostic if app has any write permission: `User.ReadWrite.All`, `Directory.ReadWrite.All`, `LicenseAssignment.ReadWrite.All`, `User.EnableDisableAccount.All`, etc.
- Use separate app instance or staged consent: read-only app first, write app later.

**Confidence:** High.

---

### F6 — Medium — AppUser ↔ Entra user mapping needs stronger invariant

**Evidence:**

- Current `AppUser` model has no Entra ID field: `packages/db/prisma/schema.prisma:100-118`.
- Plan proposes `AppUser.entraUserId`: `phase-03-onboarding-design.md:22-30`.
- Phase 04 mitigation says require stored `entraUserId`, matching UPN/email check: `phase-04-deprovision-design.md:51-55`.

**Problem:**

The plan does not state required uniqueness and immutability rules. If two local users map to one Entra object or mapping is changed silently, deprovision can hit the wrong person.

**Recommendation:**

Add data invariant:

- `entraUserId` must be unique when non-null.
- Store `entraUserPrincipalName` snapshot too, or verify live UPN/email before destructive action.
- Changing `entraUserId` requires super-admin repair action + reason + audit.

**Confidence:** High.

---

### F7 — Medium — Offboarding scope is too narrow for Microsoft 365 reality

**Evidence:**

- Phase 04 default offboarding: disable account, revoke sessions, remove license: `phase-04-deprovision-design.md:14-18`.
- Plan intentionally keeps delete out of MVP: `phase-04-deprovision-design.md:17-18`.

**Problem:**

For Microsoft 365, offboarding may also involve mailbox retention, group membership, Teams, OneDrive, device sessions, forwarding/delegation, litigation/retention policies. The plan does not need to solve all, but it must not imply disable/revoke/license is complete offboarding.

**Recommendation:**

Add explicit non-goal/manual handoff:

- ERP automation handles access cutoff + license only.
- IT remains owner for mailbox/data retention, group cleanup, device management, legal hold, archival.
- Future phase can research broader M365 offboarding.

**Confidence:** Medium. Needs Microsoft 365 admin policy confirmation.

---

### F8 — Medium — Identity Graph rate limits/backoff not specified

**Evidence:**

- Existing email worker handles Graph 429 with `RateLimitError` and backoff: `apps/api/src/services/email-outbox.ts:183-198`.
- New identity plan says durable job with retries, but does not specify 429/retry-after handling for identity Graph calls: `phase-03-onboarding-design.md:52-62`, `phase-04-deprovision-design.md:40-49`.

**Problem:**

Graph write APIs can throttle. Retrying user creation incorrectly can create duplicates or inconsistent state.

**Recommendation:**

Add operation-specific retry rules:

- Respect `Retry-After` when present.
- Never blindly retry `POST /users` without checking whether user already exists by stored Graph response or unique UPN lookup.
- Treat create step as write-once with idempotency guard at local job level.

**Confidence:** Medium. Exact Graph throttling behavior should be verified per endpoint before implementation.

---

### F9 — Low — Existing director user.create may accidentally trigger future tenant writes unless boundary is explicit

**Evidence:**

- Existing `user.create` allows directors to create users within role/facility constraints: `apps/api/src/routers/user.ts:70-155`.
- Deactivation is currently super-admin only: `apps/api/src/routers/user.ts:239-267`.

**Problem:**

If future Graph provisioning hooks directly into `user.create`, directors could indirectly create Microsoft tenant users. That may or may not be desired.

**Recommendation:**

Add plan gate:

- Separate “create local AppUser” from “provision Microsoft identity”.
- Require explicit provisioning permission, likely super_admin/IT only for first release.
- Director create should keep current local-only behavior unless user approves tenant write delegation.

**Confidence:** High.

## Confirmed Good Decisions

| Decision | Why good | Evidence |
|---|---|---|
| No implementation before approval | Correct for high-risk tenant-write work. | `plan.md:45-50` |
| Separate identity client from email client | Reduces blast radius and avoids mixing permissions. | `plan.md:63-74` |
| Read-only diagnostic first | Strong safe first step. | `phase-02-read-only-graph-diagnostic.md:9-18` |
| Durable job, not direct route side-effect | Correct for partial failure recovery. | `phase-03-onboarding-design.md:10-18` |
| Delete out of MVP | Safer default. | `phase-04-deprovision-design.md:16-18` |
| Sandbox/live-smoke required | Correct; mocks alone cannot prove tenant config. | `phase-05-validation-and-go-live-gates.md:9-22` |

## Unsupported or Needs More Verification

| Claim/area | Status |
|---|---|
| Temporary Access Pass can replace temp password in CMC flow | Plausible, but needs Graph API-specific permission research and tenant policy confirmation. |
| Exact license SKU and service plans | Unknown; must come from tenant `GET /subscribedSkus` + IT decision. |
| Ability to scope user write permissions to only CMC-created users | Not assumed by plan; keep as non-assumption. |
| Full offboarding completion | Not proven; current plan covers access/license only. |
| Whether certificate auth is operationally better than short-lived secret for this org | Needs IT operations decision. |

## Recommended Plan Edits Before User Approval

1. Add Entra role-assignment gate for sensitive app-only actions.
2. Promote TAP vs temporary-password decision from Phase 05 unresolved question to Phase 01 hard gate.
3. Forbid durable storage of plaintext temporary credential in `email_outbox.body_html`, or explicitly require synchronous/no-store delivery.
4. Require read-only diagnostic app to have read-only permissions only; fail if write roles are present.
5. Add unique/immutable `entraUserId` mapping invariant.
6. Split local user creation from Microsoft provisioning permission; do not let director local-create automatically write tenant users.
7. Define offboarding scope as “access cutoff + license recovery,” not full M365 data-retention offboarding.
8. Add Graph 429/retry/idempotency rules per operation.

## Final Security Position

Do not approve implementation yet. Approve only plan revision. The plan is close, but still has high-risk gaps around temporary secret delivery and Microsoft app-only privilege assumptions.

## Unresolved Questions

1. Should CMC prefer Temporary Access Pass over temporary password email if tenant supports it?
2. Who in IT owns Entra role assignment and app consent review?
3. Can director-created local users ever trigger Microsoft provisioning, or only super_admin/IT?
4. What exact Microsoft 365 offboarding tasks remain manual outside ERP?
