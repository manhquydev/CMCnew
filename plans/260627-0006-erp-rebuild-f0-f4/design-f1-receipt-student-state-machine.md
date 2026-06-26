# F1 — Receipt × Student × Enrollment State Machine

High-risk design artifact. Captures the transition table, dedupe rule, and void/refund branch
that govern atomic student provisioning at receipt approval.

---

## 1. Receipt Status Transitions

```
draft ──approve──▶ approved ──markSent──▶ sent ──reconcile──▶ reconciled
  │                   │                    │                      │
  └──cancel──▶ cancelled ◀────cancel───────┘◀────────cancel───────┘
```

Cancel is allowed from any status except `cancelled`. Rollback only runs when the pre-cancel
status was `approved | sent | reconciled` (i.e., the receipt was ever approved).

---

## 2. Student Lifecycle Transitions (F1-relevant)

```
[not yet created]
       │
       ▼  receipt.approve (new-student path)
   admitted
       │
       ▼  receipt.approve (provisioning activates)
    active ◀──── dedupe match (existing student already active)
       │
       ▼  receiptCancel → void branch
   [archivedAt set]  (soft-archive, never hard-delete)
```

`lifecycle` values: admitted → active → on_hold / transferred / withdrawn / completed
Only `admitted → active` is driven by F1. Archive sets `archivedAt` without changing `lifecycle`.

---

## 3. Enrollment Status Transitions (F1-relevant)

```
[not yet created]
       │
       ▼  receipt.approve (classBatchId set on receipt)
    active
       │
       ▼  receiptCancel (both void and refund branches)
  withdrawn
```

Only enrollments with `createdByReceiptId = receipt.id` are wound down. Enrollments from
other receipts or from manual `enrollment.enroll` are untouched.

---

## 4. Provisioning Decision Table (receipt.approve)

| receipt.studentId | receipt.parentPhone | Action |
|---|---|---|
| set | any | Use existing student. If parentPhone present, ensure guardian link (idempotent). |
| null | set + studentName | Dedupe by phone: hit → reuse; miss → create Student + ParentAccount + Guardian. |
| null | null | Error: cannot provision without studentId or parentPhone+studentName. |

**Dedupe key**: `ParentAccount.phone` (unique index). Secondary match when multiple children
under same parent: case-insensitive `studentName` comparison. If no name match, create new student.

**studentCode derivation**: `'HS' + receiptCode.substring(2)` → PT-2026-0001 → HS-2026-0001.
Unique because receipt codes are globally unique (atomic counter per facility/year).

**classBatchId**: optional on receipt. If set → create Enrollment (idempotent: skip on duplicate).
If absent → student is activated but not assigned to a class yet.

**createdByReceiptId on Student**: set ONLY when this receipt creates a brand-new student.
NOT set on dedupe match (reuse). This is the provenance bit that gates the void rollback.

**createdByReceiptId on Enrollment**: always set when the enrollment is created at approve.
Used to scope rollback to exactly the enrollments this receipt created.

---

## 5. Cancel Rollback Decision Table (receiptCancel)

Pre-condition: receipt was in `approved | sent | reconciled` before cancel.

| studentCreatedByReceiptId | Attendance on this receipt's enrollments | Other approved receipts | Decision |
|---|---|---|---|
| ≠ receipt.id (or null) | any | any | **refund_only** — pre-existing student, never archive |
| = receipt.id | > 0 | any | **refund_only** — genuine academic engagement |
| = receipt.id | 0 | > 0 | **refund_only** — financially active via another path |
| = receipt.id | 0 | 0 | **void_student** — mistake: archive student + withdraw enrollments |

**void_student action**:
- `student.archivedAt = now()` (soft-archive, lifecycle unchanged)
- `enrollment.status = 'withdrawn'` for all enrollments with `createdByReceiptId = receipt.id`
- Audit events on both student and each enrollment

**refund_only action**:
- `enrollment.status = 'withdrawn'` for all enrollments with `createdByReceiptId = receipt.id`
- Student record untouched

**Commission claw-back**: receipt flips to `cancelled`. Payroll period filter (`status IN approved/sent/reconciled`)
naturally excludes it. No additional logic needed.

---

## 6. Judgment Calls & Constraints

- `studentId` on Receipt is **nullable** — null for new-student receipts until approve.
  Existing receipts (from before F1) have `studentId` set; they continue to work unchanged.
- Multi-program allowed: a student may hold multiple concurrent enrollments (different batches).
  Rollback is scoped to THIS receipt's enrollments only.
- Void threshold = **zero attendance** on THIS receipt's enrollment(s). Attendance on enrollments
  from other receipts does not count toward the void threshold.
- Guardian relation defaults to `guardian`. Staff can update via the guardian router after the fact.
- If `classBatchId` is not set on the receipt, no Enrollment is created at approve. Staff must
  use `enrollment.enroll` later to place the student in a class.
