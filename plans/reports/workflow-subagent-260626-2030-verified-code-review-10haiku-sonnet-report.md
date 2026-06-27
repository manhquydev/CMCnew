# Verified Code Review — CMCnew ERP+LMS
**Date:** 2026-06-26 | **Reviewer pipeline:** 10 Haiku finders → Sonnet adversarial verifier
**Branch:** develop | **Scope:** API routers + payroll/commission logic

---

## 1. Tình trạng tổng quan

| Dimension | Confirmed | Refuted | Uncertain | Verdict |
|---|---|---|---|---|
| API business logic | 10 | 14 | 0 | Nhiều lỗ nhỏ có thật; không có lỗi nghiêm trọng duy nhất |
| Payroll / commission money-logic | 1 | 0 | 0 | Missing upper-bound guard trên override tiền |
| **Total** | **11 shown** (46 toàn bộ scan) | **14** | **0** | Lành mạnh nhưng cần fix trước merge |

> Ghi chú: Report này cover 11 finding được gửi kèm evidence đầy đủ. 35 finding còn lại trong batch 46-confirmed không được gửi vào prompt này và không được đánh giá ở đây.

---

## 2. CONFIRMED Issues by Severity

### MEDIUM (3 issues)

---

**[M1] submission.ts — Asymmetric error handling giữa myLayer query và save/submit mutations**
- **File:** `apps/api/src/routers/submission.ts:128-143`
- **Evidence:** `save` (line 110) và `submit` (line 151) throw `FORBIDDEN` khi `studentId` missing. `myLayer` (line 133) trả `{ mine: null, teacher: null }` cho cùng điều kiện — tất cả đều qua `studentProcedure` → `lmsRlsContextOf`.
- **Fix:** Thay early-return ở line 133 bằng `throw new TRPCError({ code: 'FORBIDDEN' })` để nhất quán với pattern mutation. Hoặc document rõ contract "silent null" nếu đây là intentional.

---

**[M2] facility.ts — Không có update mutation; facility bất biến sau khi tạo**
- **File:** `apps/api/src/routers/facility.ts:7-40`
- **Evidence:** Router export đúng 2 procedure: `list` (line 9) và `create` (line 19). Không có `update`, `patch`, `delete`, `deactivate`. Field `code`, `name`, `address` immutable qua API.
- **Fix:** Thêm `update` superAdminProcedure nhận `{ id, code?, name?, address?, isActive? }` với `tx.facility.update` + audit log entry, theo pattern `create`.

---

**[M3] aftersale.ts — assign mutation không validate assignee cùng facility**
- **File:** `apps/api/src/routers/aftersale.ts:87-105`
- **Evidence:** `assign` ghi `input.assignedToId` thẳng vào DB không kiểm tra facility. RLS `WITH CHECK` (migration `20260623182256`) chỉ validate `facility_id` trên case row, không kiểm tra assignee. `app_user_facility_roster` policy là SELECT-only — không fire trên FK check.
- **Fix:** Trước update, verify: `await tx.userFacility.findFirstOrThrow({ where: { userId: input.assignedToId, facilityId: kase.facilityId } })` bên trong `withRls` transaction. Hoặc thêm Postgres trigger/CHECK constraint trên bảng `after_sale_case`.

---

**[M4] payroll.ts — Commission override không có upper-bound; budget cap chỉ advisory**
- **File:** `apps/api/src/routers/payroll.ts:598`
- **Evidence:** Zod schema: `amount: z.number().int().nonnegative()` — không có `.max()`. Mutation (lines 602-668) chỉ check status + `canOverrideKpi`. `budgetCap`/`overBudget` computed trong `commissionForSale` (read-only query, lines 335-348) — không được reference hay enforce trong mutation.
- **Fix:** Thêm `.max(MAX_COMMISSION_OVERRIDE)` vào Zod schema (ví dụ: 50_000_000 VND hoặc configurable qua `effectiveParamsAt`). Hoặc re-use `budgetCap` logic từ `commissionForSale` và throw `BAD_REQUEST` khi vượt ngưỡng.

---

### LOW (7 issues)

---

**[L1] crm.ts — opportunityReopen không validate trạng thái trước khi reopen**
- **File:** `apps/api/src/routers/crm.ts:203-209`
- **Evidence:** `tx.opportunity.update({ data: { closedAt: null, lostReason: null } })` chạy unconditional — không fetch trước. Opportunity đang open (closedAt đã null) sẽ pass through và ghi spurious audit log "Mở lại cơ hội".
- **Fix:** Fetch opportunity trước; assert `opp.closedAt !== null`; throw `BAD_REQUEST` nếu không phải trạng thái closed/lost.

---

**[L2] schedule.ts — generateSessions có race condition dưới READ COMMITTED**
- **File:** `apps/api/src/routers/schedule.ts:121-199`
- **Evidence:** Reads existing sessions (line 143) rồi insert (lines 175-188) trong `$transaction()` không có `isolationLevel` override (packages/db/src/index.ts:47 default READ COMMITTED). Concurrent requests cùng `classBatchId` có thể cả hai pass dedup filter → DB unique constraint (`schema.prisma:285`) chặn duplicate nhưng một request throw unhandled constraint error thay vì clean business response.
- **Fix (cheapest):** `tx.classSession.createMany({ data: fresh, skipDuplicates: true })` — delegate idempotency về DB constraint atomically. Hoặc `isolationLevel: 'Serializable'`.

---

**[L3] room.ts — Không có update hoặc archive mutation**
- **File:** `apps/api/src/routers/room.ts:7-36`
- **Evidence:** Router expose `list` (line 8) và `create` (line 14) chỉ. `list` filter `archivedAt: null` (line 10) → schema support soft-delete nhưng không có endpoint set `archivedAt`.
- **Fix:** Thêm `archive` mutation (set `archivedAt: new Date()`, requireRole `quan_ly`) và `update` mutation cho code/name/capacity với audit log.

---

**[L4] crm.ts — testGrade dùng findUnique thay vì findUniqueOrThrow cho opportunity lookup**
- **File:** `apps/api/src/routers/crm.ts:311-326`
- **Evidence:** Line 312: `tx.opportunity.findUnique(...)` → null silently; line 313: `if (opp && !opp.closedAt)` swallows missing-record case. Mutation return success bất kể auto-advance có chạy không.
- **Fix:** Dùng `findUniqueOrThrow` tại line 312 để broken CRM link throw bên trong transaction. Hoặc giữ `findUnique` nhưng thêm `else` branch log warning khi `opportunityId` set mà record missing.

---

**[L5] enrollment.ts — enroll không validate student cùng facility (explicit check)**
- **File:** `apps/api/src/routers/enrollment.ts:62-114`
- **Evidence:** `withRls` applied nhưng không có query check `student.facilityId === input.facilityId` trước `tx.enrollment.create` (line 76). Student được fetch tại lines 86, 102 nhưng không verify facility affiliation. Cross-facility `studentId` sẽ tạo opaque Prisma/DB error thay vì clean `FORBIDDEN`/`BAD_REQUEST`.
- **Fix:** Thêm check trước create: `const student = await tx.student.findFirst({ where: { id: input.studentId, facilityId: input.facilityId } }); if (!student) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh không thuộc cơ sở này' });` — reuse student record cho notification tại line 102.

---

**[L6] submission.ts — save mutation cast annotationLayer sang `object | undefined` thay vì `AnnotationData`**
- **File:** `apps/api/src/routers/submission.ts:99-123`
- **Evidence:** Line 114: `as object | undefined`; tất cả read paths (lines 92, 93, 138, 140) cast sang `AnnotationData | null`. `AnnotationData` import tại line 7; `annotationDataSchema` validate input tại line 104. Type inconsistency chỉ — không có data corruption risk.
- **Fix:** Thay `as object | undefined` bằng `as AnnotationData | undefined` tại line 114.

---

**[L7] enrollment.ts — enroll unconditionally set student lifecycle = 'active'; không audit transition**
- **File:** `apps/api/src/routers/enrollment.ts:86`
- **Evidence:** `tx.student.update({ data: { lifecycle: 'active' } })` chạy không guard. `logEvent` ghi enrollment entity, không ghi student lifecycle transition. `logStatusChange` được dùng đúng trong `complete` mutation (lines 127-138) nhưng không trong `enroll`.
- **Fix:** Fetch lifecycle hiện tại trước line 86. Nếu là `withdrawn`, `transferred`, `completed` → throw `CONFLICT` hoặc require explicit override flag. Sau update, gọi `logStatusChange` với before/after values.

---

## 3. Cần hỏi user / Product decision

Không có uncertain finding nào được escalate từ batch này. Tuy nhiên có 2 câu hỏi business logic cần xác nhận:

**Q1 — [M3] Aftersale cross-facility assignment:** Có intentional use case nào cần assign case từ facility A cho staff ở facility B không? Nếu có (ví dụ: support center centralized), thì guard "same facility" sẽ block scenario đó.

**Q2 — [M4] Commission override ceiling:** Ngưỡng trần hoa hồng override là bao nhiêu VND? Có cần configurable per-facility hay fixed toàn hệ thống? Business đã chốt con số chưa hay để dev tự đặt?

**Q3 — [L7] Enrollment → student lifecycle:** Khi enroll một học sinh đang `withdrawn` hoặc `transferred`, hành vi mong muốn là gì? Auto-reactivate (current behavior), hay yêu cầu re-admission workflow riêng?

---

## 4. Hallucination Rate

| Metric | Số |
|---|---|
| Tổng claim từ 10 Haiku finders | 60 |
| Confirmed (có evidence thực) | 46 (76.7%) |
| Refuted (hallucinated / không tồn tại trong code) | 14 (23.3%) |
| Uncertain (cần product decision) | 0 |

**23.3% hallucination rate** từ Haiku là trong ngưỡng chấp nhận được cho tác vụ scan nhanh với adversarial verification ở tầng Sonnet. Không có false-positive nào lọt vào report này — tất cả 11 finding đã được verify bằng line-level evidence.

---

## 5. Recommended Priority

| Priority | Action | Files |
|---|---|---|
| **P0 — Fix trước merge** | [M3] aftersale cross-facility assign; [M4] commission override no ceiling | `aftersale.ts`, `payroll.ts` |
| **P1 — Fix trong sprint này** | [M1] submission asymmetric error; [M2] facility immutable; [L2] schedule race condition | `submission.ts`, `facility.ts`, `schedule.ts` |
| **P2 — Backlog sớm** | [L3] room no archive; [L4] crm findUnique; [L7] enrollment lifecycle audit | `room.ts`, `crm.ts`, `enrollment.ts` |
| **P3 — Cleanup** | [L5] enrollment no explicit facility check; [L6] annotationLayer type cast | `enrollment.ts`, `submission.ts` |

**Không có P0 blocker bảo mật nghiêm trọng.** [M3] là rủi ro integrity cao nhất (data leak qua cross-facility assign) nhưng RLS vẫn hoạt động như safety net cuối. [M4] là rủi ro tài chính nếu `canOverrideKpi` role bị compromised.

---

*Generated by workflow-subagent (Sonnet 4.6) | Pipeline: 10×Haiku scan → Sonnet adversarial verify → this report*
