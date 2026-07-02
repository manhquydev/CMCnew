# Brainstorm: Tinh gọn RBAC/HR — gộp role dư thừa (Phương án C)

Date: 2026-07-01 | Branch: develop | Mode: brainstorm-only (no code changed)

## Problem statement

ERP hiện có 12 role (`packages/db/prisma/schema.prisma:15-28`): `super_admin, quan_ly,
head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd, giam_doc_kinh_doanh,
giam_doc_dao_tao`. User muốn tổ chức ERP quanh 4 vai trò cốt lõi: giáo viên / sale / giám
đốc đào tạo / giám đốc kinh doanh (LMS: phụ huynh/học sinh — đã tách riêng, không đụng).
Team hiện <10 người, dự kiến scale lên 20-25.

Nguyên nhân gốc không phải "chưa ai nghĩ tới gọn" — RBAC hiện tại (`packages/auth/src/
permissions.ts`, explicit per-role registry, quyết định 2026-06-26) đã cố tình chọn không
kế thừa/không deny-engine để đơn giản. Vấn đề là **3 role quản lý cấp trung** (`quan_ly`,
`head_teacher`, `bgd`) trùng lặp chức năng với 2 giám đốc — dư thừa tầng quản lý khi span-
of-control 25 người vẫn nằm gọn dưới 2 giám đốc trực tiếp.

## Requirements xác nhận

- Output: xóa `quan_ly/head_teacher/bgd` khỏi Role enum + permissions.ts, giữ
  `ke_toan/hr/cskh/ctv_mkt` (chức năng nghiệp vụ thật, cần khi scale 25 người).
- Acceptance: không role nào bị "mồ côi" (permission mất hết người giữ); không phá vỡ
  separation-of-duty đã build (KPI confirm/approve, finance approve).
- Constraint: `AppUser.roles[] + primaryRole` (đã có sẵn) dùng làm cơ chế multi-role, không
  cần schema mới cho việc này.
- Touchpoints: `packages/db/prisma/schema.prisma` (Role enum + migration data), `packages/
  auth/src/permissions.ts` (285 dòng), `DIRECTOR_ROLE_GRANTS`.

## Approaches evaluated

**A. Gộp toàn bộ 7 role phụ vào 4 role** — đơn giản nhất nhưng dồn kế toán/HR/CSKH vào
1-2 giám đốc → mất kiểm soát nội bộ khi tiền/CRM do cùng người vừa tạo vừa duyệt.

**B. Giữ nguyên backend, chỉ gọn UI tạo nhân sự** — rủi ro ~0 nhưng không giải quyết vấn đề
gốc, hệ thống vẫn nặng y nguyên.

**C. Gộp chọn lọc (CHỌN)** — xóa 3 role quản lý-cấp-trung dư thừa, giữ 4 role nghiệp vụ
back-office thật. Giảm 25% số role, giữ nguyên payroll/KPI/work-shift vừa ship, scale tốt.

## Recommended solution: Phương án C

### Role enum sau khi gộp (9 role, từ 12)
`super_admin, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, giam_doc_kinh_doanh,
giam_doc_dao_tao`

### Permission re-map (7 chỗ "mồ côi" cần gán lại tường minh — đã confirm với user)

| Permission | Trước | Sau |
|---|---|---|
| `guardian.*` | `bgd, quan_ly` | cả 2 giám đốc |
| `room.create/update/archive` | `quan_ly` | `giam_doc_dao_tao` |
| `badge.create/archive` | `quan_ly` | `giam_doc_dao_tao` |
| `enrollment.complete` | `quan_ly` | `giam_doc_dao_tao` |
| `enrollment.enroll` | `quan_ly, sale` | `+ giam_doc_kinh_doanh` |
| `afterSale.setStudentLifecycle` | `quan_ly` | `giam_doc_kinh_doanh` |
| `student.update` | `quan_ly, sale` | `+ giam_doc_kinh_doanh` |
| `facilityNetwork.*` | `super_admin, quan_ly` | `+ cả 2 giám đốc` (giải luôn open-question của ADR 0020) |
| `finance.receiptApprove/Cancel/Reconcile` | `ke_toan, quan_ly` | `+ giam_doc_kinh_doanh` (kiểm soát chéo, user confirm) |

Các dòng còn lại (assessment/course/classBatch/certificate/grade/levelProgress/
parentMeeting/schedule/shiftRegistration/shiftConfig/checkInOut/crm.testGrade/dashboard/
user.listTeachers/submission) đều đã có `giam_doc_dao_tao` hoặc `giam_doc_kinh_doanh` đứng
cùng dòng với `quan_ly/head_teacher/bgd` → xóa an toàn, không mất người giữ quyền.

### DIRECTOR_ROLE_GRANTS (packages/auth/src/permissions.ts:293-296)
```
giam_doc_kinh_doanh → [sale, cskh, ctv_mkt, ke_toan, hr]   // thêm ke_toan/hr
giam_doc_dao_tao    → [giao_vien]                          // bỏ head_teacher (role chết)
```
Vá gap: hiện tại chỉ `super_admin` tạo được tài khoản `ke_toan/hr` → nghẽn cổ chai IT khi
scale. Sau khi vá, giám đốc kinh doanh tự tạo được kế toán/HR qua chính cơ chế multi-role
sẵn có (`roles[]`).

### Migration dữ liệu (rủi ro cần review kỹ trước khi chạy)
1. Với mọi `AppUser` đang có `quan_ly/head_teacher/bgd` trong `roles[]` hoặc `primaryRole`:
   remap sang `giam_doc_dao_tao` (nếu học vụ) hoặc `giam_doc_kinh_doanh` (nếu vận hành/thu
   chi) theo `EmploymentProfile.position` thực tế của người đó — cần liệt kê danh sách thật
   trước khi migrate, không đoán.
2. Postgres enum không xóa được giá trị đang bị tham chiếu → phải remap data trước, rồi mới
   `ALTER TYPE "Role" ...` (recreate enum, không có lệnh DROP VALUE trực tiếp).
3. Parity test hiện có (`apps/api/test/permission-parity.test.ts`) sẽ bắt được drift nếu
   quên chỗ nào — chạy lại sau khi sửa registry.

## Risks

- **Data loss risk nếu remap sai người**: cần liệt kê danh sách account thật đang giữ 3
  role bị xóa trước khi viết migration (không suy đoán từ tên).
- **Regression risk trên separation-of-duty**: KPI confirm/approve, finance approve đã có
  logic "không tự duyệt việc mình xác nhận" — re-map thêm giám đốc kinh doanh vào finance
  approve cần verify logic này áp dụng đúng (2 director khác nhau vẫn tách được, nhưng nếu
  chỉ có 1 giám đốc kinh doanh input+approve cùng lúc thì hết tách bạch — cần xác nhận thực
  tế có ≥2 người ở vị trí này hoặc chấp nhận rủi ro này ở quy mô nhỏ).
- **Vừa ship work-shift/check-in hôm nay** (`docs/decisions/0020`) — đổi registry ngay sau
  khi ship cần chạy lại full E2E/integration suite của tính năng này, không chỉ parity test.

## Success metrics / validation

- `permission-parity.test.ts` xanh sau khi sửa registry.
- Full API integration suite xanh (đặc biệt work-shift, KPI, finance, CRM flows).
- Không còn user nào có role `quan_ly/head_teacher/bgd` sau migration (query xác nhận).
- Giám đốc kinh doanh tạo được tài khoản `ke_toan` mới qua UI mà không cần super_admin.

## Next steps

- `/ck:plan` để tách thành phase (migration data → registry rewrite → grant fix → test) —
  nên dùng `--tdd` vì đây là refactor RBAC có test coverage sẵn (parity test, E2E work-shift).
- Trước khi code: liệt kê danh sách account thật đang giữ `quan_ly/head_teacher/bgd` để xác
  nhận đích remap từng người (không đoán từ tên role).

## Unresolved questions

- Migration Postgres enum removal có cần zero-downtime không, hay chấp nhận downtime ngắn
  (dự án đang ở giai đoạn <10 người, chưa production traffic cao)?
- Có cần giữ audit trail (ai từng là quan_ly/head_teacher) hay chỉ cần remap 1 chiều?
