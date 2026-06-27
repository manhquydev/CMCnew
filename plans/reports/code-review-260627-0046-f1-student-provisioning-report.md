# F1 Student Provisioning — Adversarial Code Review

Date: 2026-06-27
Branch: feature/erp-unify-rbac-f0 (F1 = uncommitted working tree)
Reviewer: code-reviewer (read-only)
Scope: finance.ts, student.ts, student-provisioning.ts, schema + migration, finance-panel.tsx, students-panel.tsx, index.ts, payroll.ts (reader), permission-snapshot.json, tests

Verdict: **FIX-FIRST** — 2 BLOCKER, 2 HIGH, 2 MEDIUM, 2 LOW.

Atomicity, rollback classifier, RLS scoping, commission attribution, contract `.refine`, and the nullable-`studentId` reader audit all hold up. The blockers are (a) the new-student path has no UI entry while the manual-create button was removed, and (b) a concurrent double-approve race that duplicates students.

---

## BLOCKER

### B1. New-student onboarding is unreachable from the UI — net loss of student creation
`apps/admin/src/students-panel.tsx` removes the "Thêm học sinh" create form entirely (diff: createForm/createOpen/onCreate all deleted), on the premise that students are now provisioned via receipt.approve. But the receipt-create form only supports an **existing** student:

- `apps/admin/src/finance-panel.tsx:665-680` `createDraft()` hard-requires `students.find(... studentId)` and always sends `studentId: student.id`. No `parentPhone`/`studentName`/`classBatchId` inputs exist anywhere in the panel (grep: only line 423 + 561 reference those fields, both read-only display).

Net effect: with the manual button gone and no new-student receipt form, **there is no way to onboard a brand-new student through the admin UI at all.** The F1 backend (finance.ts:308-394) is reachable only by direct tRPC call. For a "feature-completion" lane this is a functional regression, not just an incomplete nicety.

Fix: add the new-student branch to the receipt-create form (toggle: existing student vs. new — phone/name/dob/optional class batch), wired to `receiptCreate`’s F1 fields. Until then, do not remove the manual create button, or keep `student.create` reachable by an authorized staff UI.

### B2. Concurrent double-approve of a no-voucher new-student receipt duplicates the student
`apps/api/src/routers/finance.ts:266-272` reads the receipt and checks `status !== 'draft'` **before** any lock. The serializing `pg_advisory_xact_lock` is only taken later inside `nextReceiptCode` (`receipt-code.ts:11`), and the final status flip (`finance.ts:455-466`) is an **unconditional** `update`, never re-checking `status='draft'`.

Race (READ COMMITTED, two approves of the same draft — double-click / client retry):
1. T1 and T2 both read `status='draft'`, `studentId=null`.
2. No voucher → no voucher-row lock to serialize them (the voucher path at :273-285 *is* protected by the row lock + `used_count` guard; the no-voucher path is not).
3. Both pass `nextReceiptCode` serially (each gets a distinct code — so no unique-collision to save us).
4. Each runs provisioning (:362-386) and creates a **separate** new Student, both stamped `createdByReceiptId = receipt.id`.
5. Final `receipt.update` sets `studentId` to whichever commits last; the other student is orphaned (points to the receipt, but the receipt points elsewhere).

Result: duplicate Student + duplicate Guardian + a dangling provenance row. Existing-student approves are benign (studentId already set); only the new-student path corrupts.

Fix: make the draft→approved transition the concurrency guard. Either acquire the advisory lock (or `SELECT ... FOR UPDATE` on the receipt row) **before** the `status` check, or replace the final update with a conditional `updateMany({ where: { id, status: 'draft' }, ... })` and throw if `count === 0`, performed before provisioning.

---

## HIGH

### H1. Dedupe attaches a parent's second child to the wrong (only existing) sibling
`apps/api/src/routers/finance.ts:344-349`:
```ts
const activeGuardians = guardians.filter((g) => !g.student.archivedAt);
let matchedStudent = activeGuardians.length === 1
  ? activeGuardians[0]!.student                       // ← reused regardless of name
  : activeGuardians.find((g) => g.student.fullName.toLowerCase() === receipt.studentName!.toLowerCase())?.student ?? null;
```
The name disambiguation only runs when `length > 1`. Failure mode: parent has exactly **one** existing child "An"; a new receipt for the same phone with `studentName: "Bình"` (a real second child) hits the `length === 1` shortcut and **reuses "An"**. The payment, enrollment (`createdByReceiptId`), and commission are all attributed to the wrong child, and "Bình" is never created.

This matches a documented design choice (design §4: "phone hit → reuse", name match only for multi-child), but the design did not consider the parent's *second* child while only one exists. Trade-off: the shortcut tolerates name typos on a genuine renewal vs. silently merging two distinct children. Merging two real children in a finance/academic system is the worse failure (mixed money + attendance).

Fix (recommend): apply name matching uniformly — `activeGuardians.find(name match) ?? null`, create-new on miss. If the typo-tolerance was intentional, surface a UI confirmation ("reuse existing An / create new") rather than auto-merging. Needs lead/product decision since it touches a written design row — do not silently flip without sign-off.

Untested: the int suite only covers the same-name dedupe (`student-provisioning-approve.int.test.ts:174,185` both use `'HS Dedupe'`). No test exercises second-child-different-name. See M2.

### H2. Facility filter hides new-student draft receipts — the ones most needing approval
`apps/admin/src/finance-panel.tsx:450-451`:
```ts
const filtered = facilityStudentIds
  ? receipts.filter((r) => r.studentId != null && facilityStudentIds.has(r.studentId))
  : receipts;
```
New-student drafts have `studentId === null` until approve, so when an accountant filters by facility they **disappear from the list** — exactly the pending receipts they need to approve. The receipt already carries `facilityId`; the filter should key off `r.facilityId`, not a student lookup.

Fix: `receipts.filter((r) => r.facilityId === Number(filterFacilityId))` (and adjust `facilityStudentIds` plumbing accordingly).

---

## MEDIUM

### M1. Cross-facility dedupe creates a duplicate student per facility (no leak, but a fork)
`parent_account` is staff-wide (`20260624090000_identity_system_wide_rls/migration.sql:13-15` — USING `app_principal_kind()='staff'`, no facility scope), while `guardian` and `student` are facility-scoped (`20260623090658_phase2_lms_core/migration.sql:278-286`; `20260623100000_principal_aware_rls/migration.sql:29-39`). So when staff at facility B approves for a parent whose child exists only at facility A, the guardian query (`finance.ts:340-343`) returns nothing under RLS → a new Student is created at B linked to the same global ParentAccount. No cross-facility leak (RLS holds — verified), but the same human child can fork into two student records across facilities. Likely acceptable (student is a facility-scoped entity), but confirm it is intended; if a child should be shared, dedupe must run above the facility boundary.

### M2. Test coverage gaps around the disambiguation and DB-gated vacuity
- No test for H1 (second child, different name, single existing guardian).
- Integration tests early-`return` when `!dbReachable` (`student-provisioning-approve.int.test.ts:161` etc.), so in a DB-less CI they pass vacuously. Acceptable as a gate, but the suite must run against a real DB in the pipeline or these are phantom green checks. The pure classifier suite (`...classifier.unit.test.ts`) is genuinely behavioral and good.

---

## LOW

### L1. Existing-student path silently skips parent linkage when phone is new
`finance.ts:298-307`: on the existing-student path, if `parentAccount.findFirst({ phone })` misses, nothing happens — no ParentAccount created, no guardian link. Probably intended (existing student, parent optional), but it diverges from the new-student path which always creates the parent. Note for consistency; not a defect.

### L2. Migration circular FK is safe but undocumented in rollback terms
`20260627000000_student_provisioning/migration.sql` adds the student↔receipt circular FK (both nullable, `ON DELETE SET NULL`) — safe in Postgres as noted. No down-migration; consistent with repo convention. Fine.

---

## Verified GOOD (adversarial checks that passed)

- **Atomicity (#1):** provisioning + status flip share one `withRls` interactive transaction (`finance.ts:265-477`); any throw rolls back student, guardian, enrollment, voucher consume, and receipt update together. Confirmed.
- **Rollback guard (#3):** `classifyCancelRollback` (`student-provisioning.ts:55-87`) returns `refund_only` whenever `studentCreatedByReceiptId !== receiptId` — a dedupe-matched/pre-existing student (createdByReceiptId never set on reuse, finance.ts:351-361) can never be archived. `void_student` requires created-by-this-receipt AND 0 attendance AND 0 other approved receipts. Caller wires all three facts correctly (`finance.ts:577-607`). Classifier unit tests cover the matrix.
- **Nullable studentId readers (#4):** all readers handle null — `index.ts:106,118` (conditional fetch + `'—'` fallback), `finance-panel.tsx:423,451`, `receiptList` filter is `studentId.optional()` (`finance.ts:126-130`). Payroll commission (`payroll.ts:126-137,317-328,972`) keys off `soldById`+`kind`+`status`, never dereferences `studentId`. No null-deref found.
- **Commission attribution (#5):** `soldById`/`kind` frozen at approve (`finance.ts:447-465`); `priorCollected` (`:450-452`) runs after provisioning with the resolved id and `id: { not: receipt.id }`, so brand-new students get `kind='new'`. Cancelled receipts fall out of payroll via the `status IN (approved,sent,reconciled)` filter — no claw-back code needed, no double-credit.
- **Contract `.refine` (#6):** `finance.ts:162-165` blocks a receipt that can neither find (`studentId`) nor create (`parentPhone && studentName`) a student. Existing `studentId` callers unaffected.
- **Auth (#7):** `student.create` → `superAdminProcedure` (`student.ts:20`); removed from `permission-snapshot.json` consistently. No normal-staff orphan-create path remains (modulo B1, which is the inverse problem — too little reachability).
- **RLS (#8):** provisioning writes use the approving staff’s session; Student/Enrollment/Guardian all WITH-CHECK `facility_id = ANY(app_facility_ids())`, and `receipt.facilityId` is itself RLS-fetched, so writes stay in-scope.
- **Typecheck (#9):** `tsc --noEmit` on apps/api yields only the 3 known pre-existing `@azure/*` module-resolution errors. No new F1 type errors.

---

## Unresolved Questions
1. Is the missing new-student receipt UI (B1) deferred to a later phase, or in-scope for this "feature-completion" lane? If deferred, the manual student-create button removal must be reverted to avoid a dead-end.
2. H1: keep the typo-tolerant single-child reuse (accept second-child merge risk) or switch to uniform name matching with a UI confirm? Product decision.
3. M1: should a child be shared across facilities, or is a per-facility fork acceptable?
