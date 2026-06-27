# Code Review — Verified-Fix Batch (uncommitted working tree)

Date: 2026-06-27 | Reviewer: code-reviewer | Branch: develop | Mode: READ-ONLY

## Verdict: FIX-FIRST

1 blocker. Everything else is correct, side-effect-free, and ships. The single
blocker is the **finance.ts commission opportunity guard**, which is over-strict
and sits on the receipt-approval critical revenue path.

Verification performed:
- `pnpm --filter @cmc/db typecheck` → clean
- `pnpm --filter @cmc/api typecheck` → clean (no email/Graph errors surfaced in typecheck)
- `pnpm --filter @cmc/auth @cmc/admin @cmc/lms typecheck` → clean
- All `findUnique`/`upsert` callers of `code`/`studentCode` grep-audited (see §1)

DB-backed integration tests (new files) are well-structured and behavioral but
were not executed here (no DB in sandbox).

---

## 1. Unique-constraint migrations — SAFE (highest care)

Files: `schema.prisma`, `migrations/20260627060000_*`, `migrations/20260627070000_*`

- Both migrations drop the global unique and add `@@unique([facilityId, code/studentCode])`.
  Each `DROP INDEX IF EXISTS` + `ALTER TABLE DROP CONSTRAINT IF EXISTS` pair is
  belt-and-suspenders; correct for Prisma `@unique` (which generates a plain
  unique **index** `<table>_<col>_key`, so `DROP INDEX IF EXISTS` is the right verb).
- Existing-data safety: all current rows are single-facility, so the composite
  constraint is trivially satisfied. No data backfill needed.
- `Receipt.code` is nullable; composite unique over a nullable column keeps the
  pre-existing "multiple NULLs allowed" semantics (Postgres treats NULLs as
  distinct). No regression.

**Caller sync — ALL updated, typecheck-confirmed:**
- `seed-demo.ts:37` → `facilityId_studentCode`
- `seed-lms.ts:52` → `facilityId_studentCode`; `seed-lms.ts:223` → `facilityId_code`
- `verify-grading-rls.ts:15-16`, `verify-notification-rls.ts:16,22` → `facilityId_studentCode`
- All `receipt/classBatch.findUnique*` elsewhere key on `id` (audit.ts, finance.ts,
  class-batch.ts, enrollment.ts, schedule.ts, index.ts) — unaffected.
- `Course.code` / `Facility.code` remain globally unique and their `findUnique({where:{code}})`
  callers are intentionally untouched (not part of this change). Correct.

No missed callers. `@cmc/db` and `@cmc/api` typecheck clean → the regenerated
client carries `facilityId_studentCode` / `facilityId_code`.

> Note: local `prisma generate` failed with EPERM (engine DLL file-lock, a
> Windows/dev-server artifact, not a code defect). The already-generated client
> contains the new composite keys — confirmed indirectly by clean typecheck of
> the seed files that use them.

---

## 2. finance.ts commission opportunity guard — BLOCKER (over-strict)

File: `finance.ts:574-592` (inside `receipt.approve` txn)

Behavior: if `opp.studentName` is set, fetch the receipt's student and throw
`BAD_REQUEST` unless `opp.studentName === student.fullName` after `trim().toLowerCase()`.

### Why this is a blocker (High)

1. **Blast radius = whole approval, not just commission.** The throw is inside
   the approve transaction, *before* `tx.receipt.update`. A name mismatch rolls
   back the entire approval: student provisioning, LMS account creation, voucher
   consume, status/code claim — all reverted. A commission-attribution concern
   (rated Medium in the source finding) is escalated into a hard
   **revenue-collection block**.

2. **Exact-match is fragile for the real data.** `opp.studentName` is free text
   captured at lead stage (by a sale); `student.fullName` is captured later at
   student creation (possibly different staff). Divergence is normal in
   production: diacritics ("Nguyen Van An" vs "Nguyễn Văn An"), collapsed
   internal whitespace, middle-name/order variance. The guard normalizes only
   case + outer whitespace, so all of these benign cases reject a legitimate
   receipt.

3. **The link mechanism was an open question, decided unilaterally.** The source
   finding (`verify-...-finance-crm-payroll-findings-report.md:56`) explicitly
   left open: "what is the canonical opportunity↔student link to validate
   against (contact phone match? explicit studentId on opp?)". The opportunity
   carries `contactId` — a contact/phone linkage would be far more robust than a
   free-text name compare. The implementer picked the most fragile option and
   wired it as a hard gate.

4. **The e2e test passes only because it is constructed to.**
   `commission-for-sale-e2e.int.test.ts:127` sets `studentName: student.fullName`,
   guaranteeing an exact match. It does not exercise the realistic divergent-name
   case, so green CI here does not represent production safety.

### Recommended fix (pick one, proportionate)
- **Preferred:** on mismatch, do not credit commission (`soldById = null`) and
  emit an audit warning, instead of throwing. Commission can be corrected via the
  existing payroll override path. Keeps approval (revenue) unblocked.
- **Or:** validate via `opp.contactId` ↔ receipt contact/parent-phone, not name.
- **If name-match is kept:** normalize diacritics + collapse internal whitespace,
  and never block approval — degrade to non-crediting only.

### Minor (Low): redundant query
The guard re-fetches `student` by `resolvedStudentId` although a `student` row was
already fetched upstream during LMS provisioning. One extra query per approve.
Block-scoped, no shadow conflict (typecheck clean). Cosmetic.

---

## 3. payroll.ts + crm.ts — CORRECT

- `COMMISSION_RECEIPT_STATUSES = ['approved','sent','reconciled']` shared by
  `assembleSlipData` (commission) and `kpiAutoPrefill` (prefill at :986). Closes
  the parity gap (finding #3); prefill previously counted `approved` only. Spread
  `[...COMMISSION_RECEIPT_STATUSES]` to satisfy Prisma's mutable-array input — fine.
- crm.ts: `CRM_MANAGER_ROLES` gate; non-manager passing a foreign `ownerId` →
  FORBIDDEN; omit/self → allowed. Throws rather than silently coercing (clearer).
  `isSuperAdmin` handled separately. Not over-strict — only blocks the actual
  privilege escalation (crediting another user). Create-only path, matches finding #2.

## 4. submission.ts / grade.ts / attendance.ts — CORRECT

- `redactUnpublishedGrade`: type-safe — `gradeSelect` selects exactly the 5 fields
  in `GradeRow` (`id,score,maxScore,feedback,isPublished`). Returns `score:null,
  feedback:null` when unpublished; staff path (`listByExercise`) untouched → keeps
  full data. Authoritative server-side enforcement, correct.
- `save`/`submit` reject non-`published` exercise; `submit` re-checks publish state
  (retraction-after-draft) via parallel fetch. Correct.
- grade.ts: `score` is `z.number().min(0)` (lower bound) + new `score > maxScore`
  upper bound. Both ends covered.
- attendance.ts: `facilityId` made `.optional()` (backward-compat, ignored) and
  derived server-side from the session record; enrollment.classBatchId ===
  session.classBatchId guard rejects cross-batch contamination. RLS makes the two
  `findUniqueOrThrow` calls throw on foreign ids → cross-tenant safe. Correct.

## 5. user.ts + permissions — IN SYNC

- `listAssignableForAfterSale` added to registry (`permissions.ts:213`) AND snapshot
  (`permission-snapshot.json:109`). Roles `['cskh','quan_ly','giam_doc_kinh_doanh']`
  exactly match `afterSale.assign` (`permissions.ts:31`) — dropdown audience == action
  audience. RLS roster scopes facility. `cskh-panel.tsx` switched from `user.list`
  (which FORBADE cskh/quan_ly) to the new endpoint; endpoint returns
  `{id,displayName}` so `setStaffUsers` shape matches. Correct — this also fixes a
  latent bug where the assign dropdown never loaded for the roles that use it.
- student-view.tsx: clears annotation/teacher layers on modal open to stop
  cross-exercise PDF-layer bleed. Sound state-leak fix.

## 6. Typecheck/lint — CLEAN

No new typecheck errors in any touched package. (The "known pre-existing
email/Graph failures" did not appear in typecheck; if they exist they are in
test/lint, outside this batch's diff.)

---

## Edge cases / scout notes
- Migration `DROP INDEX IF EXISTS` is correct *because* Prisma emits unique
  indexes (not table constraints) for `@unique`. If any of these had been
  hand-authored as `ADD CONSTRAINT`, `DROP INDEX` would error past `IF EXISTS`.
  Verified not the case here.
- Receipt nullable-code composite unique preserves multi-NULL semantics — no
  approval-counter regression.

## Unresolved questions
1. opp-guard: is blocking receipt approval the intended product behavior, or
   should a name mismatch only suppress commission crediting? (Drives whether
   the blocker is "soften" vs "remove".)
2. Should the opp↔student link use `contactId`/phone instead of free-text name?
   (The source finding left this open; current impl chose name.)
