# Duplicate Warning Pattern Research — Receipt Creation

**Plan:** D:\project\CMCnew\plans\260705-1418-crm-finance-receipt-linkage  
**Scope:** Phương án C — soft server-side duplicate warning for new-student receipts  
**Research Date:** 2026-07-05  
**Status:** Ready for implementation

---

## 1. Mutation Input Schema (Pattern)

**File:** `apps/api/src/routers/finance.ts` (lines 472–497)

**Current Input Structure:**
```typescript
.input(
  z.object({
    facilityId: z.number().int().positive(),
    studentId: z.string().uuid().optional(),
    courseId: z.string().uuid(),
    yearsPrepaid: z.number().int().min(1).max(3),
    period: z.string().optional(),
    voucherCode: z.string().optional(),
    opportunityId: z.string().uuid().optional(),
    parentPhone: z.string().min(1).optional(),
    parentName: z.string().min(1).optional(),
    parentEmail: z.string().email().optional(),
    studentName: z.string().min(1).optional(),
    studentDob: z.string().date().optional(),
    classBatchId: z.string().uuid().optional(),
  })
  .refine((d) => d.studentId || (d.parentPhone && d.studentName), {...})
)
```

**Required Addition:**
- Add `confirmDuplicate: z.boolean().optional()` to the input object.
- No refine change needed; this flag is strictly optional and only checked in the new logic.

---

## 2. Error Handling Pattern

**File:** `apps/api/src/routers/enrollment.ts` (lines 64–72)

**Reference Pattern — "Friendly guard before P2002":**
```typescript
const dup = await tx.enrollment.findFirst({
  where: { classBatchId: input.classBatchId, studentId: input.studentId, archivedAt: null },
  select: { id: true },
});
if (dup) {
  throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã được ghi danh vào lớp này' });
}
```

**Pattern Observations:**
- Code: `CONFLICT` (not `BAD_REQUEST`) for duplicate/uniqueness violations.
- Hard-throw: immediately rejects the request.
- Message: clean Vietnamese, user-facing, identifies the conflict type.

**Existing BAD_REQUEST Examples in receiptCreate** (lines 525–532):
```typescript
if (!v) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher không hợp lệ' });
// ...
if (v.validFrom && v.validFrom > today)
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher chưa đến ngày hiệu lực' });
if (v.validTo && v.validTo < today)
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher đã hết hạn' });
```

**Soft-Warning Pattern Used in This Codebase:** Not found in existing mutations. **This will be the first "warn and retry" pattern.** Recommend using a custom response object (not an exception) to surface the warning.

---

## 3. Opportunity Model & Filtering

**File:** `packages/db/prisma/schema.prisma` (lines 1201–1226)

**Relevant Fields:**
```typescript
model Opportunity {
  id          String          @id @default(uuid()) @db.Uuid
  facilityId  Int             @map("facility_id")    // ✓ Scoping field
  contactId   String          @map("contact_id") @db.Uuid
  studentName String?         @map("student_name")
  stage       OpportunityStage @default(O1_LEAD)    // ✓ Filter field
  closedAt    DateTime?       @map("closed_at")
  // ... other fields
}
```

**Stage Enum** (lines 1160–1166):
```typescript
enum OpportunityStage {
  O1_LEAD
  O2_CONTACTED
  O3_TEST_SCHEDULED
  O4_TESTED
  O5_ENROLLED
}
```

**Scoping Query for Duplicate Check:**
```typescript
const existingOpp = await tx.opportunity.findFirst({
  where: {
    facilityId: input.facilityId,
    contact: { phone: input.parentPhone },
    stage: { not: 'O5_ENROLLED' },  // Open = not won, not lost (lostReason implies lost)
    archivedAt: null,
  },
  select: { id: true, studentName: true, contact: { select: { fullName: true } } },
});
```

**Note:** Contact is a separate model with `phone` field (lines 1181–1196); Opportunity links via contactId.  
**Design question:** Should "lost" status be checked via `lostReason != null` instead of stage? Research finding: model comment (line 1200) says "lost = closedAt + lostReason", so `lostReason != null` is the canonical lost check. Safe to use either, but `stage !== O5_ENROLLED AND lostReason IS NULL` is safest.

---

## 4. Response Mutation Pattern (No "confirm to proceed" exists)

**Search Result:** Grep for `confirm.*boolean|override.*boolean` in routers returned **no matches**.

**Conclusion:** This repo has **no existing "soft warning + retry" pattern** in mutations. All mutations either:
- Throw an error immediately (CONFLICT, BAD_REQUEST), or
- Succeed and return the created/modified entity.

**Design Decision Needed:** Two approaches for the soft warning:

### Option A: Return a Response Object with Optional Warning
```typescript
.mutation(async () => {
  // ... validation ...
  if (checkDuplicate && existingOpp && !input.confirmDuplicate) {
    return {
      status: 'warning',
      duplicateWarning: {
        opportunityId: existingOpp.id,
        parentName: existingOpp.contact.fullName,
        studentName: existingOpp.studentName,
        message: '...',
      },
      receipt: null,  // Don't create yet
    };
  }
  // Create receipt
  const receipt = await tx.receipt.create({ ... });
  return { status: 'success', receipt, duplicateWarning: null };
})
```

### Option B: Throw on First Call, Catch and Retry with Flag
```typescript
// No special response type; mutation throws CONFLICT if duplicate found
// and confirmDuplicate is false.
```

**Recommendation:** Option A (response object). Aligns better with soft-warning intent and avoids exception semantics for expected business flow.

---

## 5. Admin Frontend Error Handling & Dialog Patterns

**File:** `apps/admin/src/finance-panel.tsx` (lines 1252–1313)

**Current Error Handling:**
```typescript
async function createDraft() {
  setBusy(true);
  try {
    r = await trpc.finance.receiptCreate.mutate({ ... });
    notifySuccess(
      `Đã tạo phiếu nháp: gốc ${vnd(r.grossAmount)} ...`,
      'Tạo phiếu thu thành công',
    );
    // Reset form & call onCreated()
  } catch (e) {
    notifyError(e, 'Tạo phiếu thu thất bại');  // <-- Generic error toast
  } finally {
    setBusy(false);
  }
}
```

**Pattern:** Uses `notifyError()` for exceptions, `notifySuccess()` for success.

**UI Components Available:**
```typescript
import { Modal } from '@mantine/core';
// Modal is already imported (line 20)
// ✓ Mantine Modal component available; no new dependencies needed.
```

**Dialog Pattern:** None found for "soft warning + confirm" in finance-panel. Will need a new local state + Modal.

**Suggested Component:**
```typescript
const [duplicateWarning, setDuplicateWarning] = useState<{
  parentName: string;
  studentName?: string;
  opportunityId: string;
} | null>(null);

// In response handler:
if (response.status === 'warning') {
  setDuplicateWarning(response.duplicateWarning);
  return;
}

// In JSX:
<Modal opened={!!duplicateWarning} onClose={() => setDuplicateWarning(null)} title="...">
  <Stack>
    <Text>Có cơ hội bán hàng mở khác với cùng SĐT ...</Text>
    <Group>
      <Button onClick={() => { setDuplicateWarning(null); /* retry with flag */ }}>
        Vẫn lập phiếu
      </Button>
      <Button variant="subtle" onClick={() => setDuplicateWarning(null)}>
        Hủy
      </Button>
    </Group>
  </Stack>
</Modal>
```

**Reusable Component Question:** Could abstract to a generic `<DuplicateWarningModal>`, but first use case only (receiptCreate) suggests inline state/modal in ReceiptCreateCard is sufficient for now. YAGNI applies.

---

## 6. Implementation Requirements Summary

| Aspect | Requirement | File:Line |
|--------|-------------|-----------|
| **Input Schema** | Add `confirmDuplicate: z.boolean().optional()` | `finance.ts:475` |
| **Query** | Check Opportunity by phone, scope to facility, filter open (not O5_ENROLLED + lostReason IS NULL) | `finance.ts:~515` (pre-create) |
| **Response Type** | Define response object union: `{ status: 'success'; receipt: Receipt; } \| { status: 'warning'; duplicateWarning: {...} }` | `finance.ts:498` (mutation return type) |
| **Error Code** | Keep `BAD_REQUEST` for input validation; do NOT throw CONFLICT for soft warning | `finance.ts:~525-532` (pattern) |
| **UI State** | Add `duplicateWarning` state + Modal in ReceiptCreateCard | `finance-panel.tsx:1230` (new useState) |
| **UI Modal** | Use Mantine Modal (already imported) | `finance-panel.tsx:20` |
| **Retry Logic** | On "Vẫn lập phiếu" click, set `confirmDuplicate: true` and re-call mutation | `finance-panel.tsx:1279` (new submission branch) |

---

## 7. Unresolved Questions

1. **Stage filter logic:** Should the "open" check be `stage !== O5_ENROLLED` alone, or `stage !== O5_ENROLLED && lostReason IS NULL`? 
   - *Finding:* Model comment (line 1200) indicates lost is (closedAt + lostReason), not a stage value. Safe to use `lostReason IS NULL` as the primary lost check.
   - *Recommendation:* Use `stage: { notIn: ['O5_ENROLLED'] }, lostReason: null` for clarity and future-safety.

2. **Contact phone matching sensitivity:** Should phone match be exact or normalized (strip whitespace, convert to E.164)?
   - *Current state:* Contact model has unique([facilityId, phone]), so duplicates in DB are impossible. Need to understand if input.parentPhone undergoes normalization before storage.
   - *Action:* Verify receiptCreate receipt.parentPhone storage logic (likely raw from input).

3. **UI: Should the warning modal be modal-blocking or just a toast-notification-then-retry?**
   - *Finding:* ReceiptCreateCard is already inside a Card layout (not a form modal). A toast that blocks further action or a full modal are both feasible.
   - *Recommendation:* Use Modal for prominence and clarity; user must consciously choose "Vẫn lập phiếu" or cancel.

4. **Response type in tRPC schema:** Should the mutation's return type be a union, or always return Receipt + an optional warning field?
   - *Finding:* No existing union return types in finance.ts mutations (all return a single entity).
   - *Recommendation:* Use union: `{ status: 'success'; receipt: Receipt } | { status: 'warning'; duplicateWarning: WarningInfo; receipt: null }` for type safety.

---

## Files Ready for Implementation

- **Backend:** `D:\project\CMCnew\apps\api\src\routers\finance.ts` (receiptCreate mutation, ~50 lines delta)
- **Frontend:** `D:\project\CMCnew\apps\admin\src\finance-panel.tsx` (ReceiptCreateCard, ~100 lines delta)
- **Schema:** `D:\project\CMCnew\packages\db\prisma\schema.prisma` (no changes; Opportunity model already has required fields)

**Status:** READY FOR IMPLEMENTATION  
All code patterns identified. No dependency or design conflict found. Phone-matching normalization needs a brief check before first commit.
