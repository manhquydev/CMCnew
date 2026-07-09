# Provisioning / Enrollment — Latent-Bug Audit (report-only)

Date: 2026-07-09
Branch: develop
Scope files:
- `apps/api/src/services/teacher-lite-direct-provisioning.ts`
- `apps/api/src/services/teacher-lite-enroll-existing.ts`
- `apps/api/src/routers/enrollment.ts`
- `apps/api/src/services/student-code.ts`
- `apps/api/src/routers/finance.ts` (receipt.approve provisioning + cancel/rollback)
- `packages/auth/src/lms.ts`, `packages/ui/src/lms-login-gate.tsx`, `apps/api/src/routers/lms-auth.ts`
Governing decisions read: `0033-student-login-phone-identity.md`, `0040-teacher-lite-simplification-api-bypass.md`.

Governing rules restated (before findings):
- Decision 0040 §2 — Teacher Lite bypass removes ERP *workflow* friction ONLY; it MUST preserve tenancy/RLS, role-escalation protection, and **audit (`logEvent`)**.
- Decision 0033 D2 — student/family default password is the fixed literal `Cmc2026@` (verified `login-phone.ts:20`).
- Decision 0033 D5 — provisioning phone dedupe MUST use the SAME normalized `84xxx` value everywhere, else a returning parent entered in a different format spawns a duplicate / unlinked account.
- Decision 0033 D5 — family password is set ONCE, idempotent; a returning parent's existing family password is NEVER overwritten.

---

## Note on the "known bug" (loginCode = dead credential)

Premise as stated ("LMS UI only offers phone login → the `HQ-HS-2026-0001` break-glass code is dead") is **NOT true in the current tree**. `lms-login-gate.tsx` DOES expose the break-glass sub-mode: the "Học sinh" tab has an "Đăng nhập bằng mã học sinh (dự phòng)" anchor (`:512-521`) that switches to a loginCode+password form (`:527-587`) calling `lmsAuth.loginStudent` (`:94`), and `loginStudent` resolves by `loginCode` (`lms.ts:98-109`). So the code credential is reachable.

The real, still-live manifestation of the same theme (a credential the system hands out that does not work) is **Finding 1 below** — the password the teacher-lite email/return prints is frequently WRONG for the primary phone-login path.

---

## Finding 1 — HIGH — Teacher-lite provisioning hands out `Cmc2026@` as the login password even when it is not the family's real password

File: `apps/api/src/services/teacher-lite-direct-provisioning.ts:94,111-118,219-230,232-258`

`createTeacherLiteFamilyStudentAndEnroll` correctly PRESERVES a returning parent's existing family password (`passwordHash: parent.passwordHash ?? familyPasswordHash`, `:116`) and REUSES an existing StudentAccount without touching its password (`existingAccount ?? create(...)`, `:220-221`). But it then **unconditionally returns and emails `tempPassword: DEFAULT_STUDENT_PASSWORD` (`Cmc2026@`)** (`:244`, `:257`) and the family phone as the primary credential.

Failure scenario (repro):
1. Family (phone `84…`) is provisioned once → family password `Cmc2026@`.
2. Parent uses LMS self-service `guardian.changeFamilyPassword` and sets `Foo123@` (decision 0033 D6a; bumps tokenVersion).
3. Director provisions a 2nd/again child for the SAME phone via teacher-lite. The parent already exists → password branch keeps `Foo123@`. The returned `lmsAccount.tempPassword` and the `lms_account_ready` email still say `Cmc2026@`.
4. Parent follows the email: phone-login (the PRIMARY tab, `lms-login-gate.tsx:463-524`) with `Cmc2026@` → `loginFamilyByPhone` rejects (`lms.ts:154`) → "Sai số điện thoại hoặc mật khẩu". The shown primary credential is dead.

Same class of wrongness for an EXISTING StudentAccount whose password was rotated (e.g. via `student.resetLmsPassword`): teacher-lite reuses it (no write) yet prints `Cmc2026@` for the break-glass code path too.

Why it matters: directly login-blocking with a misleading "here is your password" instruction → parent lockout + support load. This is the genuine "dead credential shown to the user" defect.

Fix direction (report-only): return/email the password ONLY on the branch that actually just set it (new parent → new family password; new StudentAccount → new break-glass password). For a returning family, surface "dùng mật khẩu gia đình hiện có" instead of a literal, or omit the password field.

---

## Finding 2 — MED/HIGH — Guardian dedup matches on student NAME only → duplicate students OR wrong-student attach

File: `apps/api/src/services/teacher-lite-direct-provisioning.ts:121-129`

The existing-child match is `guardians.find(g => !g.student.archivedAt && sameName(g.student.fullName, input.studentName))` where `sameName` is a case-insensitive trim compare (`:37-39`). Name is the ONLY discriminator (no DOB, no explicit studentId).

Two concrete failures:
- **Wrong-student attach / silent data loss.** One parent with two real children sharing the same full name (twins; or common VN names) → provisioning the 2nd child MATCHES the 1st child's record. The 2nd child is never created; the enrollment + LMS account attach to the FIRST child. The 2nd child silently does not exist.
- **Duplicate student.** The same child entered with a spelling/diacritic/whitespace variant (`"Nguyễn An"` vs `"Nguyen An"`) → no match → a DUPLICATE `Student` (new studentCode, new StudentAccount, new enrollment) is created under the same parent.

Note `studentDob` is accepted as input (`:22`) but not used in matching. `dateOfBirth` would be the natural tiebreaker.

Why it matters: enrollment/attendance/grades land on the wrong student, or roster/LMS shows a phantom duplicate. Frequency is low (identical-name siblings) but the outcome is silent and hard to unwind.

---

## Finding 3 — MED — Direct provisioning returns "success" on a non-active existing enrollment WITHOUT reactivating it (student stuck in limbo)

File: `apps/api/src/services/teacher-lite-direct-provisioning.ts:182-208`

The enrollment guard only distinguishes `archivedAt` set (→ CONFLICT) from absent:
```
if (existingEnrollment?.archivedAt) throw CONFLICT;
if (!enrollmentId) { create active enrollment }   // else: reuse existing id, no status write
```
An existing enrollment with `archivedAt = null` but `status ∈ {withdrawn, transferred, completed}` falls through: `enrollmentId` is set, no CONFLICT, no `create`, and **no status flip back to `active`**. The function proceeds to provision LMS and returns a success payload referencing the stale enrollment.

Reachable state: student enrolled via the finance path, then the receipt is cancelled → `finance.ts:1357-1360` sets that enrollment `status: 'withdrawn'` (archivedAt is left null). A later teacher-lite re-provision of the same (batch, student) → returns success but the enrollment is still `withdrawn`. Downstream: `enrollment.listByBatch` filters `archivedAt: null` only (`enrollment.ts:44`), so the student SHOWS in the roster, but exercise access scopes `status: 'active'` — so they can't do homework. Director believes enrollment succeeded; student is inert.

Why it matters: silent inconsistent enrollment state after a cross-path (finance → teacher-lite) sequence.

---

## Finding 4 — MED — A withdrawn/transferred student can NEVER be re-enrolled into the same batch by any enroll path

Files: `enrollment.ts:66-72` (enroll), `teacher-lite-enroll-existing.ts:68-74`, `teacher-lite-direct-provisioning.ts:182-189`

The DB unique is `@@unique([classBatchId, studentId])` with NO status/archivedAt column (`schema.prisma:396`). All three enroll paths treat ANY surviving row as "already enrolled":
- `enroll` / `transfer` dup-check `findFirst({…, archivedAt: null})` → a `withdrawn` row (archivedAt null) is found → CONFLICT "đã được ghi danh".
- `enroll-existing` `findUnique(composite)` → any row → CONFLICT.
- `direct-provisioning` → Finding 3 (silent no-op).

None of them offer a "reactivate the existing withdrawn/transferred enrollment" branch. So a student withdrawn from batch X (receipt cancelled, decision-rollback) cannot be re-enrolled into X after re-payment via any UI path — the only recoveries are `transfer` INTO X from a different active enrollment, or a manual DB edit.

Why it matters: a plausible business flow (cancel → re-pay/re-enroll same class) is blocked with a confusing "already enrolled" error.

---

## Finding 5 — MED — Finance existing-student guardian dedup uses RAW `receipt.parentPhone`, not `normalizeLoginPhone` (violates decision 0033 D5)

File: `apps/api/src/routers/finance.ts:717-736`

On the existing-student approve path the guardian link is keyed off `tx.parentAccount.findFirst({ where: { phone: receipt.parentPhone } })` — the RAW receipt phone. The new-student path a few lines down correctly uses the normalized `loginPhone` (`:752-759`), and decision 0033 D5 explicitly requires the SAME normalized `84xxx` value for BOTH so a returning parent isn't missed.

Failure scenario: parent's ParentAccount is stored canonically as `84912345678` (created earlier via the normalized new-student path). A renewal receipt for an existing student carries the phone as `0912345678`. `findFirst({phone: '0912345678'})` MISSES the canonical row → `parentAcc` is null → the guardian upsert is skipped entirely (`if (parentAcc)`, `:721`). Result: the existing student is never linked to the family ParentAccount → the parent cannot see/enter that child through the phone-login family picker (`parentSession` resolves children via `Guardian`, `lms.ts:58-60`). The child is reachable only via break-glass code.

Why it matters: a paying returning family silently loses phone-login access to a child; directly contradicts the decision's dedupe-consistency requirement.

---

## Finding 6 — MED — Lifecycle reactivation in direct provisioning has NO audit event (violates decision 0040 §2)

File: `apps/api/src/services/teacher-lite-direct-provisioning.ts:161-163`

When a matched existing student is non-active, direct provisioning flips lifecycle to active with a bare `tx.student.update(... lifecycle: 'active')` and **no `logEvent`**. The two sibling paths both log this transition: `enroll-existing` (`teacher-lite-enroll-existing.ts:89-100`) and finance `enroll` (`enrollment.ts:90-101`) each emit a `status_changed` event with old→new. Decision 0040 §2 makes audit preservation a hard requirement for bypass endpoints ("Bypass removes workflow friction ONLY. It MUST preserve … audit (`logEvent`)"). This flip is invisible on the student's "Lịch sử" timeline.

Why it matters: an authorization/lifecycle state change with no audit trail on a bypass endpoint — the exact gap decision 0040 forbids.

---

## Finding 7 — LOW (latent) — `enroll` and `transfer` dup guards filter `archivedAt: null`, a latent P2002→500 trap

Files: `enrollment.ts:66-67` (enroll), `enrollment.ts:180-186` (transfer)

Both friendly dup guards filter `archivedAt: null`, but the unique constraint has no `archivedAt` (`schema.prisma:396`). The day any code sets `enrollment.archivedAt` (none does today — cancel/rollback uses `status`, `finance.ts:1359`), an archived prior row will be missed by the guard and the subsequent `create` will raise a raw Postgres `unique_violation` → surfaced as a 500 instead of a clean CONFLICT. `enroll-existing` already avoids this by using `findUnique(composite)` with no `archivedAt` filter (`teacher-lite-enroll-existing.ts:65-74`) and documents exactly this reasoning. Align `enroll`/`transfer` to the same shape.

Currently latent (unreachable while `archivedAt` is unused), hence LOW.

---

## Finding 8 — LOW — Direct provisioning skips the over-capacity soft warning

File: `apps/api/src/services/teacher-lite-direct-provisioning.ts:190-208`

`enroll` (`enrollment.ts:126`) and `enroll-existing` (`teacher-lite-enroll-existing.ts:76-113`) both compute `overCapacity` (soft, non-blocking) and return it so the UI can warn. Direct provisioning creates the enrollment with no capacity count and returns no `overCapacity`. Capacity is a soft warning only, so impact is minor — a director creating+enrolling a brand-new student into a full class gets no over-capacity nudge.

---

## Non-issues examined (documented, not defects)

- **`DEFAULT_STUDENT_PASSWORD` returned plaintext / returned even when `sendEmail=false`** (`teacher-lite-direct-provisioning.ts:257`; `finance.ts:1030,1078`): it is the fixed public constant `Cmc2026@` (decision 0033 D2; student security explicitly de-scoped). No secret is leaked. Real problem is that it is *shown when wrong* — that is Finding 1, not an exposure issue.
- **Parent `isActive=false` disables ALL children's phone login** (`lms.ts:55,153,177,193`): deactivating a ParentAccount kills `loginFamilyByPhone` + `enterChildProfile` + any live parent/family session for every guardianed child. Break-glass `loginStudent` (studentAccount-scoped) still works. This is the intended family-credential coupling (decision 0033); documented residual, not a defect.
- **Concurrent same-phone provisioning** (`teacher-lite-direct-provisioning.ts:71` advisory lock on `loginPhone`; email-unique collisions caught by outer `P2002 → CONFLICT` at `:262-269`): converges cleanly; loser gets a CONFLICT rather than a 500. Acceptable.
- **`nextDirectStudentCode` collision/race** (`student-code.ts:17-33`): per-(facility,year) advisory xact lock + counter upsert + post-check existence loop. Race-safe; the loop backstops a code already taken by the legacy receipt-derived scheme. No defect.
- **finance new-parent first-sibling race** (`finance.ts:774-803`): SAVEPOINT + `INSERT … ON CONFLICT (phone) DO NOTHING` + refetch, per decision 0033 D5. Correctly keeps the money tx alive. No defect.

---

## Unresolved questions

1. Is "re-enroll a withdrawn student into the same batch after re-payment" (Finding 4) a required business flow? If yes, the fix is a reactivate branch, not just a friendlier error.
2. Should teacher-lite guardian match use `studentDob` (already an input) as a tiebreaker (Finding 2), or should the director pick an existing student explicitly (the `enroll-existing` path already exists for that)?
3. For Finding 1, product decision: suppress the password field for returning families, or force-reset to `Cmc2026@` on every provision (contradicts decision 0033 D5 "never overwrite existing family password")?

---

Status: DONE
Findings by severity: HIGH 1 (Finding 1) · MED/HIGH 1 (Finding 2) · MED 4 (Findings 3,4,5,6) · LOW 2 (Findings 7,8). Total 8 defects + 5 documented non-issues. No source files modified.
