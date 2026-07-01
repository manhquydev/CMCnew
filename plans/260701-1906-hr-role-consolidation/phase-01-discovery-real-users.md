# Phase 1 — Discovery: liệt kê user thật cần remap

## Context links
Parent: `plan.md`. Brainstorm: `plans/reports/brainstorm-260701-1906-hr-role-consolidation-report.md`.

## Overview
- Date: 2026-07-01 | Priority: P0 (blocks Phase 2/3) | Status: done
- Không đoán remap target từ tên role — phải xem `EmploymentProfile.position` +
  `managerId` thật của từng account đang giữ `quan_ly/head_teacher/bgd`.

## Key Insights
- `bgd` xác nhận dormant (comment code) nhưng vẫn cần query DB thật để chắc chắn 0 row.
- `quan_ly`/`head_teacher` là role đang hoạt động — chắc chắn có user thật gắn với chúng.

## Requirements
- Query mọi `AppUser` có `quan_ly|head_teacher|bgd` trong `roles[]` hoặc = `primaryRole`.
- Với mỗi user: lấy kèm `EmploymentProfile.position`, `managerId`, facility.
- Phân loại remap target: học vụ (`quan_ly` làm lịch/lớp, `head_teacher`) →
  `giam_doc_dao_tao`; vận hành/thu-chi (`quan_ly` duyệt phiếu/CRM) → `giam_doc_kinh_doanh`.
  Nếu 1 user làm cả hai, remap sang cả 2 (dùng `roles[]` multi-role sẵn có, chọn 1 làm
  `primaryRole` theo việc chính họ làm nhiều nhất).

## Architecture
Không đổi code ở phase này — chỉ query + báo cáo (read-only script hoặc `psql`).

## Related code files
- `packages/db/prisma/schema.prisma` (AppUser, EmploymentProfile)
- Không sửa file nào ở phase này.

## Implementation Steps
1. Viết query (SQL hoặc Prisma script) liệt kê AppUser theo role bị xóa + EmploymentProfile.
2. Đối chiếu `managerId` chain để xác nhận ai đang report cho ai.
3. Lập bảng remap: `{userId, email, current roles, remap target roles, remap primaryRole}`.
4. Trình bảng cho user xác nhận trước khi sang Phase 3 (KHÔNG tự quyết remap ambiguous case).

## Todo list
- [x] Query prod/dev DB liệt kê user theo 3 role bị xóa
- [x] Đối chiếu EmploymentProfile.position + managerId
- [x] Lập bảng remap draft
- [x] User xác nhận bảng remap (đặc biệt case 1 người làm cả học vụ+vận hành)

## Success Criteria
Có bảng remap đầy đủ, mỗi user bị ảnh hưởng có đích remap rõ ràng, đã user-confirm.

## Risk Assessment
Remap sai người → mất quyền truy cập thật của nhân viên đó sau migration. Không tự đoán —
bảng remap PHẢI được user xác nhận (theo nguyên tắc "ask before ambiguous business logic").

## Security Considerations
Không có thay đổi quyền ở phase này (read-only).

## Next steps
Sang Phase 2 (viết test trước cho registry mới) chỉ sau khi có bảng remap đã confirm.
