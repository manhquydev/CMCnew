# Code Review: Employee Code "CMCx" (Plan B)

Scope: employeeCode-related hunks in schema.prisma, migration 20260704221500_employee_code,
payroll.ts (profileUpsert), shift-registration.ts (list batch-map only), shift-reg-list-panel.tsx.
Plan A hunks in shift-registration.ts (assertFutureFrom, updateDates, draft/submitted lock) were
skipped per instructions — already reviewed separately.

## Verdict: No blocking defects found. Analysis below confirms the implementer's reasoning holds.

## 1. Migration correctness — OK
- `ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)` + `LPAD(rn::text,4,'0')` is correct and
  deterministic (id tie-break avoids ORDER BY instability on equal timestamps).
- `WHERE employee_code IS NULL` guard makes the backfill step idempotent for re-runs of the raw SQL:
  a second run only assigns codes to rows still NULL (e.g. profiles created between deploy and this
  migration), it never re-touches already-coded rows, so no double-prefixing risk.
- Counter step (`INSERT...ON CONFLICT DO UPDATE SET last_seq = EXCLUDED.last_seq`) recomputes
  `last_seq` from `COUNT(employee_code IS NOT NULL)` each run — also idempotent, self-correcting if
  new rows were coded between runs.
- In practice Prisma's `_prisma_migrations` ledger prevents `prisma migrate deploy` from
  re-applying this file automatically; the idempotency guards are a genuine safety net only against
  manual/ops re-execution of the raw SQL, which is the actual threat model here — correctly handled.

## 2. Code-assignment atomicity in payroll.ts:453-493 — OK, verified against shift-registration's counter pattern
- `INSERT INTO employee_code_counter (id, last_seq) VALUES (1,1) ON CONFLICT (id) DO UPDATE SET
  last_seq = last_seq + 1 RETURNING last_seq` (payroll.ts:485-489) is byte-for-byte the same pattern
  as `shift_code_counter` in shift-registration.ts:409-414 (submit). Single-row UPSERT-increment is
  atomic under Postgres row-level locking — two concurrent transactions serialize on the counter row,
  no lost updates, no duplicate sequence values.
- TOCTOU check for the *same* userId, concurrent `profileUpsert` calls: traced through
  `withRls` (packages/db/src/index.ts:63, `prisma.$transaction`, default READ COMMITTED). The
  `employmentProfile.upsert(where:{userId})` on payroll.ts:453 takes a row lock on the target
  `employment_profile` row (or the not-yet-existing-row unique-constraint path — see caveat below).
  For the common case (profile already exists, employeeCode still null): txn A's upsert(update)
  locks the row; txn B's upsert(update) blocks on the same row. When A commits (employeeCode now
  set), B's blocked UPDATE re-evaluates under READ COMMITTED semantics and returns the *current*
  row state for columns it didn't touch — so B observes `profile.employeeCode` already populated by
  A and skips the `if (!profile.employeeCode)` branch entirely. No double-assignment, no failed
  update, no unique-constraint violation. This is correct and matches the counter/row-lock precedent
  already used for `shift_code_counter`.
- Caveat (pre-existing, not introduced by this diff): if the profile row does not exist yet and two
  concurrent `profileUpsert` calls both hit the upsert's `create` branch, one will fail with a P2002
  unique violation on `employment_profile.user_id` (not on employeeCode) — that failure surfaces as
  a generic mutation error to the loser, not a corruption. This is an existing property of
  `employmentProfile.upsert`, unrelated to the employeeCode feature; flagging only for completeness
  since the review prompt asked to "dig into" this exact path.

## 3. employeeCode format edge case (>9999) — OK
- `employee_code` column is `TEXT` (schema.prisma:1416, migration.sql:5) with only a UNIQUE index,
  no length/format CHECK constraint. `CMC10000` (8 chars) is accepted without issue.
- No regex validation on employeeCode anywhere else in the codebase (verified via grep across
  apps/ and packages/) — display is plain string interpolation, so 5-digit sequences don't break
  any downstream consumer.

## 4. Batch-map merge in shift-registration.ts:120-163 (employeeCode-related hunk only) — OK
- `codeMap.get(r.userId) ?? null` on line 161 correctly falls back to `null` for any userId with no
  `EmploymentProfile` row (HS/PH accounts should never appear here since `list` is staff-scoped via
  `visibleRegistrationWhere`/`requirePermission`, but even a staff account never onboarded by HR is
  handled without crashing).
- Two extra batched queries (`appUser.findMany`, `employmentProfile.findMany`, both `IN (...)`) —
  not N+1, scales with distinct userIds in the page, not per-row.

## 5. Display fallback in shift-reg-list-panel.tsx:106 — OK
- `r.user.employeeCode ? \`${r.user.employeeCode} · ${r.user.displayName}\` : r.user.displayName`
  correctly falls back to plain displayName when employeeCode is null/undefined — no "undefined"
  string rendered, no crash. The outer `r.user ? (...) : <Text c="dimmed">—</Text>` guard (line
  103-115) also already protects the no-EmploymentProfile / no-AppUser-match case.

## 6. RLS reasoning sanity-check — Deviation is justified, not a real gap
- `employee_code_counter` RLS policy (`app_is_super_admin() OR app_principal_kind()='staff'`) does
  let any staff-kind principal read/write the counter row at the DB layer — broader than
  `shift_code_counter`'s facility-scoped policy, but that's correct here because this counter is
  genuinely global (no facility_id column, matches the `20260624090000_identity_system_wide_rls`
  precedent for other non-facility-scoped tables).
- The actual authorization boundary is the app-level permission gate, not RLS: `profileUpsert` (the
  only code path that touches this counter) is registered in `packages/auth/src/permissions.ts:221`
  as `['giam_doc_kinh_doanh', 'giam_doc_dao_tao']` only — a `giao_vien` with no HR duties cannot
  reach this mutation regardless of what RLS alone would permit. RLS here is a defense-in-depth
  floor for a table with no sensitive payload (just an integer sequence), not the primary
  authorization mechanism — staff-wide DB access is an acceptable, low-risk choice given that.

## Informational / non-blocking observations
- `payroll.ts:490` — `counter[0]?.next ?? 1` fallback: if the `RETURNING` row were ever empty this
  would silently reuse sequence `1` (collision with the very first employee code) instead of
  throwing. In practice `INSERT...ON CONFLICT DO UPDATE...RETURNING` always returns exactly one row,
  so this is unreachable in normal operation — flagging only because it's a silent-swallow pattern;
  the identical fallback already exists in the pre-existing `shift_code_counter` code this was
  copied from, so it's consistent with established precedent rather than a new risk.
- The `shift-reg-list-panel.tsx` list now also surfaces `r.user.email` for any staff registration
  the viewer can see (managers/HR/directors per `visibleRegistrationWhere`). Not a new exposure
  vector introduced by this diff (email was already queryable via other staff-directory endpoints
  by the same roles) — noting only for completeness, no action needed.

## Unresolved Questions
None — all six focus areas from the task were verifiable directly against the diff/migration/schema
and existing precedent (`shift_code_counter`, `20260624090000_identity_system_wide_rls`,
`packages/auth/src/permissions.ts`).
