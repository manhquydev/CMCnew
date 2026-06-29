# 0015 ERP-Driven Microsoft Graph Identity Provisioning

Date: 2026-06-29

## Status

Proposed

## Context

CMC has Microsoft 365 (Microsoft Entra ID tenant `CMC`). Staff ERP login already uses Microsoft Single Sign-On (decision in `auth-sso-otp-redirection.md`), and `AppUser` must exist and be active before SSO succeeds (no just-in-time creation). Outbound email already runs through Microsoft Graph `sendMail` with an outbox (decision `0013-email-microsoft-graph-integration.md`).

A new request asks whether ERP should automate the Microsoft staff lifecycle:

- create Microsoft user (`POST /users`),
- assign Microsoft 365 license (`POST /users/{id}/assignLicense`),
- deliver a temporary credential to the employee,
- deprovision later (disable, revoke sessions, remove license).

This is materially more dangerous than current Graph email. Email sends as approved mailboxes. This proposal **writes tenant identities and licenses**. App-only Microsoft Graph access acts as its own identity with no signed-in user, and Microsoft documents it as broad and powerful; some sensitive actions also require a Microsoft Entra admin role in addition to Graph permissions.

Supporting artifacts:

- Research: `plans/reports/hard-research-260629-1409-microsoft-graph-identity-provisioning-tenant-write-report.md`
- Plan: `plans/260629-1409-microsoft-graph-identity-provisioning-hard-plan/plan.md`
- Security critique: `plans/reports/security-critique-260629-1424-microsoft-graph-identity-provisioning-plan-report.md`

## Decision

Adopt the security posture below as the precondition for any future implementation. This ADR does **not** authorize writing tenant identities yet; it fixes the rules that any future implementation ADR amendment must satisfy.

1. **Default stays manual.** ERP keeps SSO + manual Microsoft pre-provisioning until a follow-up decision explicitly flips this ADR to Accepted with tenant-write enabled.
2. **Separate Entra app (CMCnew policy).** Identity provisioning, if built, uses a separate Entra app registration (`CMC ERP Identity Provisioner`) with its own credential, distinct from the SSO/email app. This is CMCnew blast-radius policy, not a Microsoft platform requirement.
3. **Least privilege + role proof.** For every operation, both the Microsoft Graph application permission and any required Microsoft Entra role assignment must be verified before enabling. Avoid `Directory.ReadWrite.All` unless a specific verified operation requires it.
4. **Read-only first.** First implementation step is a read-only diagnostic (token + `GET /subscribedSkus`) on an app that has read-only consent only. Fail the diagnostic if write roles are already granted.
5. **No durable plaintext credential.** Temporary password or Temporary Access Pass value must never be stored durably (not in job rows, not in `email_outbox.body_html`, not in logs/traces). Onboarding credential method (Temporary Access Pass vs temporary password vs manual IT) must be chosen before onboarding is built.
6. **Provisioning is privileged and separate from local create.** Creating a local `AppUser` (already delegated to directors) must not automatically write a Microsoft identity. Microsoft provisioning requires an explicit, stronger permission (super_admin/IT for first release).
7. **Safe deprovision scope.** MVP offboarding = disable account + revoke sessions + remove CMC-managed license. Delete is out of MVP. Privileged Microsoft admin accounts are manual-only. Full Microsoft 365 data-retention offboarding (mailbox, OneDrive, Teams, devices, legal hold) remains IT-owned.
8. **Identity mapping invariant.** `AppUser.entraUserId` must be unique when non-null; destructive Microsoft actions verify stored id plus expected UPN/email; changing the mapping needs an audited repair action.
9. **Durable + idempotent + audited.** Provisioning/deprovisioning runs as a durable step-state job with operation-specific Graph retry rules (respect `Retry-After`, never blind-retry `POST /users`), full audit, and redacted errors.
10. **Sandbox proof before production.** Live enablement requires sandbox/smoke proof on a disposable non-admin user, a tested rollback runbook, and a production feature flag defaulted off.

## Alternatives Considered

1. **Keep manual Microsoft provisioning + ERP SSO (current).** Lowest risk, more admin effort. This stays the default.
2. **Extend the existing SSO/email Graph app with identity-write permissions.** Rejected: makes one credential able to send mail *and* manage identities, enlarging blast radius.
3. **Delegated admin flow from ERP.** A signed-in admin acts via Graph delegated permissions, so privilege follows the human. Stronger accountability, more UX/integration work. Deferred as a possible later version.
4. **Microsoft Entra Lifecycle Workflows / native governance.** Native offboarding tooling; licensing and integration cost unclear. Deferred for later evaluation.

## Consequences

Positive:

- Tenant-write risk is gated by explicit policy, not discovered late.
- Separation of email Graph and identity Graph limits blast radius.
- Credential handling rules prevent plaintext leakage.
- Offboarding scope is honest about what stays manual.

Tradeoffs:

- More setup (separate app, consent, role review) before any automation value.
- Read-only-first and sandbox-first slow time-to-feature.
- Some answers still depend on Microsoft tenant policy and IT confirmation.

## Follow-Up

- Decide: approve or reject ERP as Microsoft tenant identity writer.
- Choose credential method: Temporary Access Pass, temporary password (no durable store), or manual IT onboarding.
- Confirm staff license SKU mapping by role from `GET /subscribedSkus`.
- Confirm required Microsoft Entra role assignments per operation and who owns app consent.
- On approval, amend this ADR to Accepted with the enabled scope, then execute the hard plan phases.

## Amendment Templates (fill on approval)

These are ready-to-accept variants. To approve, the user/IT picks ONE option per axis, sets the chosen block's status line, dates it, and re-registers status with `harness-cli`. Until then this ADR stays **Proposed** and the default (manual SSO pre-provisioning) holds. No option here authorizes implementation by itself — each still requires the read-only diagnostic (Phase 02) to pass first.

### Axis A — Tenant-write authorization

- **A0 (default, no amendment):** ERP does NOT write Microsoft identities. Keep manual Entra pre-provisioning + SSO. Hard plan stops after Phase 01.
- **A1 — Read-only only:** Authorize ONLY the read-only diagnostic app (`LicenseAssignment.Read.All`, token + `GET /subscribedSkus`). No `POST/PATCH/assignLicense`. Unblocks Phase 02 only.
  - Accept line: `Status: Accepted (A1 read-only) — YYYY-MM-DD`
- **A2 — Onboarding write:** Authorize create-user + assign-license via the separate provisioner app, super_admin/IT-triggered only. Requires A1 passed. Unblocks Phase 03.
  - Accept line: `Status: Accepted (A2 onboarding) — YYYY-MM-DD`
- **A3 — Full lifecycle:** A2 plus deprovision (disable + revoke + remove license). Delete stays out. Requires A2 proven in sandbox. Unblocks Phase 04.
  - Accept line: `Status: Accepted (A3 full lifecycle) — YYYY-MM-DD`

### Axis B — Credential delivery (only relevant if A2+)

- **B1 — Temporary Access Pass (preferred):** Create user, then issue a TAP via Entra; deliver TAP out-of-band/short-lived; no durable plaintext. Requires: TAP policy enabled for the staff group, and verification of the exact Graph API + permission to create a TAP programmatically (NOT yet verified — Phase 01 must confirm).
  - Pre-req gate: `TAP API + permission verified: yes/no — <doc link>`
- **B2 — Temporary password (no durable store):** `passwordProfile` with `forceChangePasswordNextSignIn: true`; deliver synchronously with NO plaintext persisted in job rows, `email_outbox.body_html`, logs, or traces. Weaker than B1.
- **B3 — Manual IT onboarding:** ERP creates user + assigns license (or none), IT sets the first credential by hand. Lowest app-permission risk; ERP never handles a credential.

### Axis C — Offboarding scope (only relevant if A3)

- **C1 — Access cutoff + license (MVP):** disable account, revoke sessions, remove CMC-managed license. Everything else manual (mailbox, OneDrive, Teams, devices, legal hold).
- **C2 — C1 + scheduled delete:** add `DELETE /users` after a retention window (e.g. N days). Requires explicit retention policy and higher Entra role verification; privileged accounts still manual.

### Amendment procedure

1. Pick A / B / C options; paste the chosen accept line(s) under `## Status`.
2. Record SKU mapping by role and the verified permission+role list as a new `## Enabled Scope` subsection.
3. Re-register: `harness-cli decision add` already holds id `0015`; update status when the durable layer supports it, else note acceptance in the trace.
4. Proceed only to the phase the chosen axis unblocks.
