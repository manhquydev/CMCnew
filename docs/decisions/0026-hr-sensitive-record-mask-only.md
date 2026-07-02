# HR sensitive record: mask-only + role-gate + audit (encryption deferred)

Date: 2026-07-02

## Status

Accepted

## Context

The full HR onboarding record is missing 4 columns: `address`, `nationalId` (CCCD),
`bankAccount`, `bankName`. `EmploymentProfile` (`schema.prisma:1324-1345`) has
`managerId` and `startedAt` but none of these. CCCD and bank account are sensitive
personal/financial data that must not be visible to all staff roles. No column-encryption
helper exists in the repo (0 hits for encrypt/pgcrypto/cipher).

## Decision

1. **4 new nullable columns** on `employment_profile`: `address`, `national_id`,
   `bank_account`, `bank_name`. All nullable (existing rows have none). Additive migration,
   no backfill.

2. **Mask-only + role-gated read.** CCCD/bank are stored **plaintext** this round. A
   `maskSensitive(value)` helper masks on read (e.g. CCCD → `•••••••• 1234`, bank → last
   4). An authz predicate `canReadSensitiveHr(session)` = `super_admin` OR
   `giam_doc_kinh_doanh` OR `giam_doc_dao_tao` gates full-value read. Masking happens
   server-side in the profile read resolver — never rely on the client to hide.

3. **Audit-on-change.** Every sensitive-field change writes an audit event recording the
   **field name** and actor — never the raw value. `logEvent` records field-changed, not
   value.

4. **Column-level encryption DEFERRED to DEBT.** No pgcrypto/encryption infra exists;
   building it this round violates KISS. The residual risk (plaintext at rest) is
   documented and accepted for the interim test/interim environment. Encryption is a DEBT
   item for the real prod rebuild.

## Alternatives Considered

1. pgcrypto column encryption now. Rejected: no existing encryption infra in the repo;
   KISS violation; adds key-management surface that the interim environment does not
   justify.
2. Client-side masking only. Rejected: insecure — raw values would still leave the API.
3. Don't store CCCD/bank at all. Rejected: onboarding requires them for payroll and
   legal records.

## Consequences

Positive:

- Full HR record captured in one onboarding form.
- Sensitive data access controlled by role; non-privileged roles see masks.
- Every sensitive change is auditable.

Tradeoffs:

- CCCD/bank are plaintext at rest this round. Residual risk accepted for interim; encryption
  is a tracked DEBT item.
- Helpers must NEVER emit raw values to `logEvent` — audit records field-changed only.

## Follow-Up

- DEBT.md: column-level encryption for CCCD/bank (deferred).
- Unit tests: `maskSensitive` format matrix; `canReadSensitiveHr` role predicate matrix.
- Integration: masking matrix (non-privileged sees mask, 2 directors + super_admin see
  full); audit-on-change writes field name only.
