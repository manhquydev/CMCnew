# Flow Verify — CRM → Admission → Student Provisioning (live API)

Date: 2026-06-27 | API: http://localhost:4000 | DB: pg@5433 (seeded) | Actor: admin@cmc.local (super_admin, facility 1)

Method: tRPC-over-curl (raw JSON, non-superjson). Source of truth: `apps/api/src/routers/{crm,finance,student}.ts`.

## Setup (test data I created)
- Course `40e85c51-…881ecf` (Course-P, UCREA) had NO effective price → created price 12,000,000đ/năm eff.2026-01-01.
- Class batch `5d9038ec-…6a98b1` (CB-S4, course Course-S4) used for enrollment.

## Step → Result

| # | Step | Result | HTTP | Evidence |
|---|------|--------|------|----------|
| 1 | Login super_admin | PASS | 200 | session userId 5685c57f…, facilityIds [1] |
| 2a | crm.contactCreate | PASS | 200 | id 801b0d59…; phone normalized 0911000777→+84911000777 |
| 2b | crm.opportunityCreate (O1_LEAD) | PASS | 200 | opp f6967701…, ownerId=creator |
| 2c | opportunityTransition O1→O2 | PASS | 200 | stage O2_CONTACTED |
| 2d | testCreate(entrance) auto-hook | PASS | 200 | opp auto-advanced → **O3_TEST_SCHEDULED** |
| 2e | testGrade(8.5/pass) auto-hook | PASS | 200 | opp auto-advanced → **O4_TESTED** |
| 2f | opportunityTransition O4→O5 | PASS | 200 | stage O5_ENROLLED, closedAt set (won) |
| 3a | finance.receiptCreate NEW-STUDENT (no studentId; parentPhone+studentName+classBatchId) | PASS | 200 | draft; gross 12M, tier 15%, net 10.2M; studentId null; code null |
| 3b | finance.receiptApprove | PASS | 200 | code PT-2026-1060; **student provisioned** da7742b2…; soldById set; kind=**new** (O5 won) |
| 3c | student.detail verify | PASS | 200 | lifecycle=active; guardian linked (parent c7083cec…); enrollment active (createdByReceiptId set); receipt linked |
| 4a | Re-approve (idempotency) | PASS | 400 | BAD_REQUEST "Phiếu thu không ở trạng thái nháp" |
| 4b | Dedupe: 2nd receipt same parentPhone+studentName → approve | PASS | 200 | reused SAME student da7742b2…; kind=**renewal**; enrollment idempotent (still 1) |
| 4c | Cancel receipt 1 (refund_only: student has other approved receipt) | PASS | 200 | status cancelled; student stays active/archivedAt null; only its enrollment → withdrawn |
| 4d | Cancel fresh single-receipt student (void_student) | PASS | 200 | student 975ec272… soft-archived → absent from student.list |

## Server log
Baseline 5 lines (startup only). After the full run: still 5 lines, NO request logging, NO error/stack/prisma/500/warn entries. The 400 responses in 4a are tRPC business-rule error envelopes returned to the client, not server-side exceptions.

```
✓ CMCnew API on http://localhost:4000
```
(no further lines)

## Findings

1. **[LOW — data integrity gap] receipt.courseId vs classBatch.course not validated.** receiptCreate/receiptApprove never check that `classBatchId` belongs to `courseId`. In this run a Course-P receipt enrolled the student into a CB-S4 batch (course Course-S4) with no error. Enrollment succeeds with a course mismatch between what was paid for and what the student is enrolled in. Evidence: receipt courseId 40e85c51…(Course-P) → enrollment batch 5d9038ec… course e2fe2bff…(Course-S4). Recommendation: validate batch.courseId === receipt.courseId at create or approve.

2. **[INFO] kind=renewal on dedupe is by design but worth noting.** The 2nd receipt (4b) had no opportunityId, so attribution fell to the priorCollected>0 branch → renewal, even though it targets the same just-created student. Matches code intent (commission design); flagged only so finance reviewers expect it.

3. **[INFO] No price seeded for courses.** Seeded Course-P had no CoursePrice; receiptCreate correctly rejects priceless courses ("Khóa học chưa có giá hiệu lực"). Operationally, courses must get a price before any receipt — confirm seed covers this for go-live.

## Unresolved Qs
- Should classBatchId be constrained to the receipt's course? (finding 1 — product decision)
- Dev log has no per-request/error logging; if prod expects request logs, that wiring is absent here.

---
flow works? **YES** — full CRM→admission→provisioning chain + all 4 edge cases PASS, no server errors.
bug count: **1** (LOW: course/batch mismatch not validated) + 2 INFO notes.

Status: DONE
