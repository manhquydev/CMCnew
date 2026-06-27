# F1 — Student provisioning atomic @ receipt.approve (HIGH-RISK)

Rủi ro: **CAO** (data model, finance, authorization). Cần story high-risk (execplan/design/validation) + xác nhận user trước khi code.
Phụ thuộc: F0. Mở đường: F2.

## Context
- `plans/reports/compare-260626-2218-erp-lms-vs-openeducat-odoo-admissions-report.md`
- `plans/reports/decision-260626-2338-receipt-reversal-student-rollback-report.md`
- `plans/reports/gap-analysis-260626-2338-business-completeness-report.md`
- xia: `02_student_enrollment.md`, `06_crm_admission.md`, `07_financial_receipts.md`

## Requirements (quyết định đã khóa)
1. **Tạo Student atomic tại `receipt.approve`** (`finance.ts:229-286`): trong 1 transaction tạo/khớp Student + Enrollment + link Guardian + set lifecycle `active`, audit đầy đủ. Mô phỏng `enroll_student()` OpenEduCat.
2. **Dedupe theo SĐT phụ huynh**: find-or-create Student (qua Guardian/ParentAccount.phone) trước khi tạo mới.
3. **Provenance**: thêm field `Student.createdByReceiptId` (nullable). Chỉ set khi receipt này thực sự sinh ra Student mới (KHÔNG set khi dedupe khớp HS có sẵn).
4. **Gỡ `student.create` khỏi UI vận hành**: xoá nút "Thêm học sinh" (`apps/admin/src/students-panel.tsx:341-380`); giữ procedure `student.ts:17-48` nhưng hạ xuống nội bộ (role hẹp/seed, cờ rõ + audit bắt buộc).
5. **Rollback khi `receiptCancel` (`finance.ts:341-370`)**:
   - Void-do-nhầm (Student do CHÍNH receipt này sinh — `createdByReceiptId == receipt.id` — và chưa đi học / không có receipt approved khác): soft-archive Student (`archivedAt`) + set enrollment withdrawn + audit.
   - Hoàn-tiền-thật (Student đã tồn tại trước / đã có buổi học / dedupe khớp): GIỮ Student, chỉ đóng enrollment liên quan.
   - **Tuyệt đối không hard-delete**; HS dedupe (có sẵn) không bao giờ bị archive.
   - Commission claw-back: theo cơ chế period mở (`payroll.ts:133-135`), khóa khi finalized/paid.

## Files (dự kiến)
- `packages/db/prisma/schema.prisma`: thêm `Student.createdByReceiptId` + migration.
- `apps/api/src/routers/finance.ts`: `receipt.approve` (+provisioning), `receiptCancel` (+rollback theo provenance).
- `apps/api/src/routers/student.ts`: hạ cấp `student.create`.
- `apps/api/src/routers/enrollment.ts`: helper enroll dùng lại trong transaction.
- `apps/admin/src/students-panel.tsx`: gỡ nút tạo.
- `packages/domain-*`: helper dedupe + provisioning thuần (test được).

## Steps
1. Thiết kế state machine receipt↔student lifecycle (bảng chuyển trạng thái) — chốt trong design.md.
2. Migration `createdByReceiptId`.
3. Provisioning helper (pure) + unit test: tạo mới / dedupe khớp / nhiều con cùng SĐT PH.
4. Khâu vào `receipt.approve` transaction.
5. Rollback trong `receiptCancel` phân nhánh provenance + test 2 nhánh + guard HS-có-sẵn.
6. Gỡ UI tạo + chặn đường tạo Student ngoài seam.

## Validation
- Unit: provisioning (mới/dedupe/đa-con), rollback (void vs refund), guard không-archive-HS-cũ.
- Integration: approve→student xuất hiện active; cancel→đúng nhánh; không tạo được HS mồ côi.
- RLS: provisioning đặt đúng facility.
- build + typecheck xanh.

## Risks / Rollback
- Transaction một phần lỗi → đảm bảo atomic (rollback DB). 
- Đổi `receipt.approve` đụng commission → test attribution không đổi.
- Migration trên prod cần DB (lưu ý: migration repo có thể chưa apply — cần môi trường DB).

## Cần user chốt (trong design)
- Multi-program: 1 HS nhiều enrollment cùng lúc? (ảnh hưởng dedupe + rollback phạm vi enrollment).
- Receipt approved nhưng HS chưa từng đi học bao lâu thì coi là "chưa đi học" (mốc void-do-nhầm)?
