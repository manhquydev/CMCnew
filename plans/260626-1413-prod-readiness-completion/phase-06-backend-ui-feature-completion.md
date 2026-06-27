# Phase 06 — Backend↔UI Feature Completion

**Risk:** NORMAL | **Depends:** Phase 02

## Requirements

Đấu nối các procedure backend đã có nhưng thiếu UI (operators đang phải dùng raw DB), + thêm student management.

## Admin (`apps/admin/src/`)

### 1. Finance: price + voucher UI
- `finance-panel.tsx`: wire `finance.priceCreate/priceList` (set giá khóa học) + `finance.voucherCreate/voucherList` (tạo/list/deactivate voucher). Operators hết phải sửa DB tay.
- Receipt: pagination + search + facilityId filter (H22).

### 2. Payslip lifecycle UI
- `payroll-panel.tsx`: wire full lifecycle `profileUpsert`, `rateCreate/rateList`, `payslipCompute → payslipFinalize → payslipMarkPaid → payslipReopen`, `payslipPeriodSummary`. Hiện chỉ có bulk pay.
- Status badge Vietnamese labels.

### 3. Student management panel (mới)
- `students-panel.tsx`: create/list/search/edit (lifecycle, facilityId, courseId)/deactivate. Thêm `student.update` backend (`student.ts`). Hiện student chỉ tạo qua seed.

### 4. CRM contact + CSKH assign
- `crm-panel.tsx`: wire `crm.contactList` + contact detail/edit modal; filter open/closed; pagination.
- `cskh-panel.tsx`: wire `afterSale.assign` (gán case); thêm Chatter per-case (`after_sale_case`).

### 5. Error/loading states (review medium batch)
- overview/org/finance/guardians/crm/cskh panels: phân biệt loading vs empty vs error; Alert + retry; bỏ silent `catch(()=>setX([]))`.

## Rewards review (`rewards.ts` + UI)
- Wire `rewards.giftCreate` + `rewards.review` (admin/teaching) → redemption hết kẹt `pending`. Star refund on reject (đã có domain logic).

## Other backend gaps
- `parent-meeting.ts` `setSchedule`: form confirm datetime (đã đưa Phase 04 MeetingsTab).
- `student.update`, `course.update`, `room.update`, `crm.contactUpdate`: thêm update mutations role-gated.

## Validation

- Int-test: `student.update` authz; `afterSale.assign`; `rewards.review` refund.
- Admin typecheck green; mỗi panel wire-up render data thật + error state.
- Live: tạo giá/voucher từ UI; compute→finalize→pay payslip từ UI; assign CSKH case; duyệt đổi quà.

## Risks / Rollback

- Nhiều panel đụng cùng file App.tsx → chia nhỏ commit per-panel.
- `payslipCompute` đọc KPI từ Phase 03 → đảm bảo thứ tự (Phase 03 trước phần payslip UI dùng KPI).
