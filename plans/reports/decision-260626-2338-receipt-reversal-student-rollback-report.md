# Decision — Receipt reversal vs. auto-provisioned Student rollback

Date: 2026-06-26 · Mode: research-only (READ-ONLY, no code changed)
Scope: what happens to a Student (+Enrollment +Guardian) when the approved receipt that
"gave birth" to it is later cancelled / rejected / refunded.

Locked prior decision (context): Student is provisioned **atomically at `receipt.approve`**
(student born only when money is paid; dedupe by parent phone; `student.create` removed from
operational UI). See `compare-260626-2218-...md` §6 and `02_student_enrollment.md` decision #1.

---

## 1. CMC current reality (file:line)

**Receipt status enum — there is NO `rejected`.**
- `schema.prisma:838-844` → `ReceiptStatus { draft, approved, sent, reconciled, cancelled }`.
  "Reject" and "cancel" are the same terminal state today: `cancelled`.

**Reject-after-approve already EXISTS — via `receiptCancel`, and it is unrestricted.**
- `finance.ts:341-370` (`receiptCancel`): the only guard is `if (status === 'cancelled') throw`.
  So an **approved / sent / reconciled** receipt **can be cancelled today**. Approve is reversible.
- On cancel it: (a) refunds the voucher use iff `voucherId && status !== 'draft'`
  (`finance.ts:349-354`, atomic `used_count - 1`), (b) flips status → `cancelled`, stamps
  `cancelledAt` + `cancelReason`, (c) writes a `RecordEvent` (`finance.ts:359-367`).
  It does **NOT** touch Student, Enrollment, Guardian, or commission attribution.

**Crucial: `receipt.approve` does NOT yet create a Student.**
- `finance.ts:229-286` (`receiptApprove`): consumes voucher, allocates `PT-YYYY-NNNN`, **freezes
  commission** (`soldById`, `kind` at `:256-273`), flips to `approved`. **No Student/Enrollment/
  Guardian creation.** The atomic-provisioning seam is the *planned* (locked, not-yet-built) change.
  → Therefore **no student-rollback logic exists today**, and none is needed *until* provisioning
  lands. This decision defines the rollback contract that the provisioning work must ship with.

**Student lifecycle states (no "rejected"/"prospect"/"cancelled").**
- `schema.prisma:35-42` → `StudentLifecycle { admitted, active, on_hold, transferred, withdrawn, completed }`.
  Natural "left / undone" terminal = `withdrawn`. `admitted` = pre-enrollment; `active` set by first
  enrollment (`enrollment.ts:90-101`).
- `Student.archivedAt` exists (`schema.prisma:159`) = soft-delete channel. **No router hard-deletes
  a Student or Enrollment** (verified: no `.delete(` in finance/student/enrollment routers).

**Enrollment.**
- `schema.prisma:291-307`: `EnrollmentStatus { active, completed, reserved, transferred, withdrawn }`,
  `archivedAt` soft-delete, `opportunityId` for CRM trace. Lifecycle→active on first enroll
  (`enrollment.ts:90-101`).

**Commission attribution + claw-back wiring (already favourable).**
- Payroll sums receipts `WHERE status IN ('approved','sent','reconciled')`
  (`payroll.ts:133-135, 324-326`) and sales KPI revenue uses `status: 'approved'`
  (`payroll.ts:976-985`). A `cancelled` receipt **automatically drops out** of every commission
  total → claw-back is automatic **while the period is still open**.
- BUT a finalized/paid payroll/KPI run is locked (`payroll.ts:703` filters `status IN
  ('finalized','paid')`; a finalized KPI sheet snapshots its score). After lock, claw-back is no
  longer automatic and must be a forward adjustment.

---

## 2. How Odoo / OpenEduCat handle it (immutability + reversal doc) — short

- **Odoo accounting:** a posted `account.move` (invoice) or `account.payment` is **never deleted**.
  Correction = post a **reversal / credit note** (a *new* `account.move` with opposite signs) that
  reconciles against the original. The original row and its audit chain persist forever. Cancelling
  a draft is fine; cancelling a *posted* doc means reverse, not erase.
- **OpenEduCat fees:** a paid fee term is reversed/refunded as a new entry; the admission/student
  record produced by `enroll_student()` is **not destroyed** when a fee is later corrected — the
  student is a `res.partner`, a durable contact, decoupled from the fee document's state.
- **Principle:** approved financial records are immutable; corrections are *new* entries, not
  deletions. The person/contact created by the process is durable and outlives a single document.

CMC already honours this at the receipt layer: cancel **keeps the row**, flips status, refunds the
voucher, and logs `RecordEvent`. For a cash-basis single-table ledger (report 07 rec. #1: keep it),
**the persisted `cancelled` row + RecordEvent IS the credit-note/audit trail** — a separate
`account.move`-style reversal table is over-engineering (YAGNI). The open question is only what the
reversal does to the *student* side-effects.

---

## 3. DECISION

**Allow reject/cancel-after-approve (do NOT pick option 3's hard ban), NEVER hard-delete a Student,
and split behaviour by provenance + maturity. Concretely: option (2) "keep + lifecycle + audit" is
the default; a narrow "mistake void" may additionally *soft-archive* a student that this very
receipt created and that has done nothing real yet.**

Rationale:
- Option 3 (disallow) is a regression — CMC already permits it and a tutoring center *needs*
  same-day correction of mis-keyed receipts. Rejected.
- Option 1 (hard rollback / physical delete) violates accounting immutability and is dangerous when
  dedupe matched a pre-existing student. Rejected as a blanket rule.
- The honest middle: a wrongly-approved receipt that *auto-created* a brand-new student who never
  attended is a **data-entry mistake** → safe to undo the provisioning **by soft-archive, not
  delete**. A refund of a student who actually attended is a **genuine event** → the student is real
  and stays; only the enrollment winds down.

### Two cases, defined

Decide with a single test computed at void time —
`bornByThisReceipt = Student was created in THIS receipt's approve txn  AND  has no OTHER
approved/sent/reconciled receipt  AND  has no Attendance rows  AND  has no other active Enrollment`.
(Provenance needs a new nullable `createdByReceiptId` on Student and Enrollment, written in the
provisioning txn. Without it, default to the safe case = keep.)

**(a) Mistake void — "approved by error / not yet attended / born by this receipt"**
(`bornByThisReceipt === true`)
- **Receipt:** `→ cancelled`, `cancelReason` required (existing `receiptCancel` path); voucher use
  refunded (existing). The row persists = the reversal record.
- **Student:** `lifecycle → withdrawn` **and** `archivedAt = now()` (soft-archive; row + audit kept,
  hidden from operational lists). **Never** physical delete.
- **Enrollment:** the enrollment created by this receipt → `status = withdrawn`, `archivedAt = now()`.
- **Commission:** auto-removed (status filter) if period open; forward adjustment if already paid.
- **Guardian:** keep the link by default (cheap, reusable). Only archive a Guardian that was
  auto-created by this receipt *and* whose only student is the now-archived one.
- **Audit:** `RecordEvent` `provision_reversed` on student + enrollment, referencing the receipt.

**(b) Genuine refund — "real student / attended / pre-existing / has other receipts"**
(`bornByThisReceipt === false`)
- **Receipt:** `→ cancelled` with reason (or a future `refundedAmount` flag if cash physically left
  — no new table needed; reuse `cancelReason` + optional amount field). Row persists.
- **Student:** **stays. Not archived, not deleted.** `lifecycle → withdrawn` **only if** this was the
  student's sole active enrollment; otherwise leave lifecycle untouched (still has live classes).
- **Enrollment:** the one tied to this receipt → `status = withdrawn` (kept, not archived — it is
  real history).
- **Commission:** same auto-/forward-adjustment rule.
- **Guardian:** always kept.
- **Audit:** `RecordEvent` `refunded` referencing the receipt.

**No separate `rejected` enum value.** "Reject a draft" = cancel a `draft` (no side effects — voucher
not yet consumed, no student yet). "Reject after approve" = cancel a non-draft = the reversal above.
The `status !== 'draft'` branch in `receiptCancel` already encodes the only distinction that matters.

---

## 4. State machine — receipt transition × student effect

| From | Action | To | Voucher | Student / Enrollment effect |
|---|---|---|---|---|
| draft | approve | approved | consume (atomic) | **(provisioning seam)** create/dedupe Student + Enrollment + Guardian, freeze commission |
| draft | cancel/reject | cancelled | none | none (nothing was provisioned) |
| approved | markSent | sent | — | none |
| approved / sent | reconcile | reconciled | — | none |
| approved / sent / reconciled | cancel — **mistake** (bornByThisReceipt) | cancelled | refund −1 | Student `→withdrawn + archivedAt`; Enrollment `→withdrawn + archivedAt`; Guardian kept; commission auto-drops (if period open) |
| approved / sent / reconciled | cancel — **refund** (real student) | cancelled | refund −1 | Student kept (`→withdrawn` only if sole enrollment); Enrollment `→withdrawn`; Guardian kept; commission auto-drops / forward-adjust |
| cancelled | any | — | — | blocked (`finance.ts:346`) |

Student lifecycle effects summarised: provisioning sets `active`; mistake void → `withdrawn` +
archived; refund → `withdrawn` iff sole enrollment; otherwise unchanged. `withdrawn` is the only new
target — no schema enum change needed.

---

## 5. Edge cases

1. **Dedupe hit (student PRE-EXISTED) — the load-bearing guard.** If approve matched an existing
   student by parent phone (did not create one), `createdByReceiptId` is null → `bornByThisReceipt =
   false` → case (b). The rollback **must never archive/delete that student**; it only withdraws the
   enrollment this receipt added (if any). This is exactly why provenance must be recorded at
   provisioning, not inferred after the fact.
2. **Student created by THIS receipt but already attended / has a second receipt.** `bornByThisReceipt
   = false` (attendance or other receipt fails the test) → case (b), student stays. Correct: they
   became real the moment they showed up or paid again.
3. **Commission claw-back across a closed period.** Open period → automatic (status filter). Finalized/
   paid payroll/KPI run (`payroll.ts:703`) is locked → do **not** mutate the locked run; record a
   negative/forward adjustment in the next period. Mutating a paid commission run is itself an
   accounting-immutability violation.
4. **Guardian link.** Keep by default — a parent legitimately has other children and the link is a
   cheap junction (`Guardian`, `schema.prisma:458`). Archive only an auto-created Guardian whose sole
   student just got archived. Never delete a `ParentAccount`.
5. **Multiple receipts → one enrollment / one student.** Withdraw only the enrollment this receipt
   created; never touch enrollments owned by other receipts. The "sole active enrollment" test gates
   whether the student's lifecycle flips.
6. **Re-approve / re-pay after a mistake void.** Archived student should be findable by the same
   dedupe (parent phone) so a later correct receipt restores rather than duplicates. Dedupe query must
   include `archivedAt != null` candidates (un-archive on match) — otherwise a fixed re-entry creates
   a twin. (Confirm with provisioning implementation.)

---

## 6. Effort, risks, confirmations

**Effort (lands WITH the provisioning seam, not before):**
- Schema: add nullable `createdByReceiptId` to `Student` and `Enrollment` (+ index). Optional later:
  `refundedAmount` on `Receipt`. No enum changes.
- `receiptApprove`: write provenance when it provisions (part of the locked provisioning work).
- `receiptCancel`: add the provenance/maturity branch + soft-archive/withdraw + `provision_reversed`/
  `refunded` audit. ~40–60 lines, one transaction, reuses existing `logEvent` + voucher refund.
- Dedupe query: include archived students; un-archive on re-provision.

**Risks:**
- Mis-classifying a real student as "mistake" → wrongly archived. Mitigated by the conservative
  default (any doubt → case (b) keep) and soft-archive (recoverable, never delete).
- Forgotten provenance write → every void degrades to "keep" (safe, but mistake-students linger as
  `withdrawn` orphans). Acceptable failure mode.
- Locked-period commission: needs the forward-adjustment convention to actually exist in payroll, or
  finance will quietly over-credit. Flag for payroll owner.

**User must confirm:**
- **Mistake window definition:** is "born by this receipt + never attended" sufficient, or also a
  time bound (e.g. same calendar day / before reconciled)? Recommend the behavioural test (attended?)
  over a clock.
- **Visibility of mistake-voids:** soft-archive (hidden) vs. keep visible as `withdrawn`. Recommend
  soft-archive to keep operational lists clean while preserving audit.
- **Cash-refund modelling:** is a `cancelled` status enough, or do you want an explicit
  `refundedAmount`/`refunded` flag when money physically leaves (for the finance report)? Recommend
  deferring (YAGNI) until a cash-refund report is actually required.
- **Closed-period claw-back:** confirm the forward-adjustment path in payroll, or accept manual
  correction for now.

---

Status: DONE
</content>
</invoke>
