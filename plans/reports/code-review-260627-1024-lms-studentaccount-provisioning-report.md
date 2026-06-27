# Code Review — LMS StudentAccount Provisioning (receipt.approve)

Date: 2026-06-27
Reviewer: code-reviewer (adversarial / production-readiness)
Branch: feature/lms-lifecycle-and-deep-tests
Verdict: **SHIP** (with 2 follow-ups; 0 blockers)

> Note: `git diff develop...HEAD` is empty — develop and HEAD are the same commit (64f76af). The feature is already committed. Reviewed the current source state directly.

## Scope
- `apps/api/src/routers/finance.ts` (receiptApprove, lines 272-597, genTempPassword 22-25)
- `apps/api/src/routers/student.ts` (resetLmsPassword 142-182, detail account select 89-96)
- `packages/db/prisma/schema.prisma` (StudentAccount 463-474, Receipt.parentEmail 976)
- `packages/auth/src/permissions.ts` (student.resetLmsPassword 198)
- `apps/admin/src/student-detail.tsx` (LmsAccountSection 77-136, account block 178-200)
- `apps/api/src/services/email-templates.ts` (lms_account_ready 127-145)
- Supporting: `email-outbox.ts`, `trpc.ts`, `withRls` (db/index.ts), RLS migration 20260624090000

Typecheck: api ✅, admin ✅, auth ✅ (tsc --noEmit, exit 0). No new errors.

## Overall Assessment
The feature is genuinely additive and well-constructed. Existing provisioning, commission attribution, and the concurrent-approve guard are untouched. Idempotency and credential-at-creation handling are correct. The two notable findings are (a) a misleading comment that overstates coverage and (b) a defense-in-depth ordering weakness in `resetLmsPassword` that is currently masked by transaction rollback. Neither blocks ship.

---

## Findings by Requirement

### 1. Additive / no regression — PASS
- `receiptApprove` keeps the existing flow intact: status guard (finance.ts:282), voucher consume (286-296), atomic draft claim (307-313), student dedupe/create (319-444), lifecycle activation (446-462), enrollment + course-match guard (464-504), commission `soldById`/`kind` freeze (563-584). The LMS block (505-559) is inserted between enrollment and commission and does not mutate any of those paths.
- Cancel/rollback paths not in this diff; provenance fields (`createdByReceiptId` on student/enrollment) untouched, so rollback scoping is unaffected.
- Return shape change is additive: `{ ...approved, lmsAccount }` (596). Backward compatible.

### 2. Idempotency — PASS
- Re-approve: early status guard (282) + atomic `updateMany WHERE status='draft'` claim (307-313) make re-approve and concurrent double-approve throw. StudentAccount creation cannot run twice for the same receipt.
- Dedupe-matched existing student: `wasNewStudent` stays false, so the `!existingLmsAcc && wasNewStudent` gate (518) is false → no account created, `lmsAccount` stays null (596). Correct.
- `existingLmsAcc` lookup on `studentId` (@unique) is a redundant-but-safe guard; an existing account is never overwritten and its password is never reset by approve.
- `loginCode` uniqueness respected (= studentCode, @unique).

### 3. Credential safety — PASS (1 low note)
- Only `passwordHash` (bcrypt, 10 rounds) is stored on the account. Plaintext `tempPassword` is `randomBytes(6).toString('hex')` (48-bit, acceptable for a relayed temp credential that is reset on first use), returned exactly once (596) and never written to a log/audit body — `logEvent` records only the loginCode (536) and tokenVersion (176).
- `resetLmsPassword` bumps `tokenVersion` (163) inside the same tx, invalidating live LMS JWTs. Returns the new password once (180).
- Gating: registry `['quan_ly','giam_doc_kinh_doanh','giam_doc_dao_tao']` (permissions.ts:198) bound via `requirePermission` with `super_admin` bypass (trpc.ts:71). Snapshot fixture `apps/api/test/fixtures/permission-snapshot.json:104` matches the registry — consistent.
- `student.detail` exposes only `loginCode/isActive/createdAt` (student.ts:89-96); hash excluded. Admin UI mirrors this (student-detail.tsx:178-196).
- **LOW** — Temp password is persisted at rest via the email path: `enqueueEmail` renders `lms_account_ready` (incl. plaintext password, email-templates.ts:140) into `email_outbox.body_html` (email-outbox.ts:46,56). When Graph is unconfigured the worker is a no-op and rows stay queued indefinitely, so the plaintext password lingers in the DB. Requirement #3's "not persisted" is technically violated for the email branch only (the `resetLmsPassword` path does NOT email, so no persistence there). This is the standard transactional-email tradeoff; acceptable, but consider pruning sent/stale outbox rows. No action required to ship.

### 4. Atomicity — PASS
- `withRls` wraps everything in `prisma.$transaction` (db/index.ts:47). StudentAccount create (522), audit log, and email enqueue all share the receipt-approve tx. Any later throw (e.g. commission lookup, receipt update) rolls back the account too — no orphan account with an unpaid/unapproved receipt.

### 5. parentEmail — PASS
- Optional column `Receipt.parentEmail String?` (schema 976). Absent → no email enqueued (guarded by `if (receipt.parentEmail && lmsAccount)` at 542) and no crash; outbox is a no-op when Graph absent.
- Set on ParentAccount at create (351) and back-filled on existing account only when different (419: `parentAcc.email !== receipt.parentEmail`), with unique-violation caught and logged (425-435) rather than aborting the approve. Does not silently clobber a different existing email with a failure. OTP path enabled. Correct.

### 6. Typecheck/lint — PASS
- No new type errors in api/admin/auth.

---

## Issues

### MEDIUM — `resetLmsPassword` facility scoping is ordering-dependent (defense-in-depth)
`student.ts:146-170`: the mutation updates `student_account` (158) **before** it verifies the student exists/in-scope via `student.findUniqueOrThrow` (167). `student_account` RLS is global-staff (no facility scope — migration 20260624090000); facility scope comes only from the later `student` lookup. A cross-facility `studentId` would currently still be rejected, but only because the `student` lookup throws and the `$transaction` rolls back the already-applied password reset. The guard is implicit and order-fragile: if the `student` lookup is ever removed/reordered, a director could reset a student's LMS password in another facility.
- Fix: look up `student` (facility-scoped) FIRST, throw if not found, then update the account. Makes the scope check explicit and order-independent.

### MEDIUM — Misleading comment: claimed "forward-fill" is not implemented
`finance.ts:506-509` states accounts are created when "(b) the student has no StudentAccount yet (forward-fill for students enrolled before this feature)." The actual condition is `!existingLmsAcc && wasNewStudent` (518) — case (b) never fires. Renewal receipts (`receipt.studentId` set) and dedupe-matched existing students do NOT get an account at approve. This matches the stated task scope ("only for NEW students"), so the code is fine, but the comment overstates behavior and will mislead the next maintainer.
- Fix: correct the comment to "only brand-new students," or implement the backfill if pre-existing students are meant to gain LMS access here. Note: the CONTEXT goal ("students couldn't access the LMS after enrollment") is only met for new students — pre-existing students remain without an auto-provisioned account.

### LOW — Reset button shown to unauthorized staff
`student-detail.tsx:104-114`: the "Đặt lại mật khẩu" button renders for any staff who can open student.detail (a `protectedProcedure`, all staff). Unauthorized roles (e.g. sale, giao_vien) see the button and get a server FORBIDDEN on click. Server gating is authoritative (no security hole), but conditionally rendering by role would avoid the dead-end UX.

### LOW — Pre-existing cross-facility studentCode collision (not introduced here)
`studentCode` = `'HS' + code.substring(2)` derived from the per-facility receipt counter (receipt-code.ts:11-17), while both `Student.studentCode` and `StudentAccount.loginCode` are **globally** `@unique` (schema 157, 467). Two facilities allocating the same yearly sequence produce the same `HS-YYYY-NNNN`. The collision already aborts at `student.create` (pre-existing F1 behavior), so the new `loginCode` does not add a new failure surface — but it inherits the latent bug. If global student-code uniqueness is intended across branches, the counter should embed the facility. Flagging for awareness; out of this feature's scope.

### LOW — `preheader` uses unescaped `loginCode`
`email-templates.ts:131`: `Mã đăng nhập: ${d.loginCode}` is interpolated without `esc()`. `loginCode` is system-generated (`HS-…`), so injection risk is nil, but every other dynamic field in the file is escaped — keep it consistent.

---

## Positive Observations (risk-relevant)
- Atomic draft claim (307-313) correctly prevents concurrent double-provisioning; the LMS block inherits that protection for free.
- `enqueueEmail` dedupKey `lms_account_ready:${studentId}` (546) prevents duplicate notifications on retry.
- Permission registry and the snapshot fixture are in sync — no drift.
- Integration tests exist (`apps/api/test/lms-student-account-provisioning.int.test.ts`) covering idempotency, tokenVersion bump, and NOT_FOUND on reset.

## Unresolved Questions
1. Is the "forward-fill" of LMS accounts for pre-existing/renewal students intended (the comment implies yes, the code says no)? This determines whether MEDIUM #2 is a comment fix or a missing feature.
2. Is `student_account.body_html` retention in the outbox (plaintext temp password when Graph is off) acceptable, or should a prune job be added?
3. Should `Student.studentCode`/`loginCode` global uniqueness be facility-scoped, or is the receipt counter meant to be globally unique?
