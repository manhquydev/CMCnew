# Plan — Hoàn thiện luồng vận hành + UI cơ bản (operational-flow-ui-hardening)

> Lập: 2026-06-25 15:42 · Nhánh: develop · Lane: **high-risk** (intake #10)
> Mục tiêu giai đoạn: luồng chạy được end-to-end **đầy đủ + validate**, chưa cần đẹp.
> Design system để sau khi nghiệp vụ LMS/ERP ổn định.

## Bối cảnh (đã scout, có bằng chứng)

- **Backend/domain rất chín**: 30 router API, TEST_MATRIX toàn `implemented`, nhiều mục PASS.
- **UI = Tabs + panel** (Mantine + tRPC), không dùng router đa trang.
  - admin: 7 tab (tổng quan, khóa học, cơ sở&người dùng, phụ huynh, nhân sự&lương, KPI, cơ cấu lương).
  - teaching: 16 tab (lịch, buổi, ghi danh, điểm danh, họp PH, nhật ký, lớp, chấm bài, học bạ, duyệt cấp độ, CRM, phiếu thu, CSKH, chứng chỉ, phiếu lương của tôi, lương).
  - lms: student-view + parent-view — đã ráp Leaderboard, NotificationCenter, live NotificationStream, BadgeShelf, Chatter (UI đầy đủ nhất).
- **Component dùng chung đã có** trong `packages/ui`: leaderboard, notification-center, notification-stream, badge-shelf, chatter, pdf-viewer/annotator.

## Khoảng trống thật (bằng chứng)

| # | Vấn đề | Bằng chứng | Ảnh hưởng |
|---|---|---|---|
| G1 | **Không app nào mount `<Notifications/>`** → toast không hiển thị được | `grep <Notifications` apps/ = trống; provider.tsx ghi "apps add it themselves" | Mọi feedback thành công/lỗi bất khả thi |
| G2 | **Lỗi bị nuốt lặng** | 44 `.catch()` nhưng `notifications.show`=0 toàn hệ | User không biết thao tác fail |
| G3 | **Form hầu như không validate** | validate-ish: admin 1, teaching 0, lms 2 | Nhập sai vẫn submit → lỗi khó hiểu |
| G4 | Leaderboard/NotificationCenter chỉ có ở LMS | admin/teaching không import | ERP role chưa có trung tâm thông báo (đánh giá sau, không bắt buộc) |

## Phases

| Phase | Tên | Track | Status | Depends |
|---|---|---|---|---|
| F1 | **Nền feedback**: mount `<Notifications/>` trong AppProviders + helper `notify*` ở @cmc/ui | nền | ✅ done (typecheck 4/4 + lms build) | — |
| F2 | **Nền validate**: bộ validator dùng chung (required/email/số dương…) + chuẩn Mantine useForm | nền | ✅ done (validators.ts + ráp mẫu admin Khóa học) | — |
| A | ERP học vụ (teaching 16 tab): notify+validate cho create/enroll/attendance/grading; empty/error state | A | ✅ done (100 notify, 0 silent catch, 3 form; typecheck+build xanh) | F1,F2 |
| B | Tài chính + lương (teaching finance/payroll + admin hr/payroll/kpi): notify+validate phiếu thu, payslip, KPI workflow, cơ cấu lương | B | ✅ done (69 notify, 0 silent catch; validate imperative+toast; typecheck+build xanh) | F1,F2 |
| C | LMS (student/parent): validate submission/redeem, error feedback (lms catch=4, notify=0), edge cases | C | ✅ done (14 notify, guard nộp bài rỗng, redeem hết sao báo rõ; typecheck+build xanh) | F1,F2 |
| D | Quản trị + nền chung (admin org/user/course/guardian): validate+notify; cân nhắc NotificationCenter cho ERP | D | ✅ done (62 notify, Facilities+User→useForm email/minLength; typecheck+build xanh) | F1,F2 |

> **HOÀN TẤT 2026-06-25.** Toàn monorepo typecheck **13/13 xanh**, 4 app build OK, **0 `.catch(()=>{})` nuốt lỗi** toàn hệ. Tổng ~245 toast feedback. NotificationCenter cho ERP role: chưa làm (đánh giá sau, không bắt buộc giai đoạn này).

F1, F2 độc lập → song song. A/B/C/D cần F1+F2; có ranh giới file rõ → có thể song song theo app.

## Pattern mẫu (đã chốt, dùng cho A–D)

Form admin "Khóa học" = bản tham chiếu: `useForm` + `validate:{ field: combine(required(), minLength()) }`,
`getInputProps` + `withAsterisk`, submit qua `form.onSubmit(create)`; mutation `.catch(notifyError)`,
thành công gọi `notifySuccess`; mọi `.query().catch(...)` đổi sang `notifyError`. Bỏ hẳn state `err` cục bộ.
Xem `apps/admin/src/App.tsx` hàm `Courses`.

## Acceptance Criteria

- [ ] F1: gọi `notifyError(e)`/`notifySuccess(msg)` từ bất kỳ app → toast hiện thật. Typecheck xanh.
- [ ] F2: có helper validate dùng chung; form mẫu (1 form/app) chặn submit khi sai + hiện lỗi cạnh field.
- [ ] A: 5 thao tác học vụ chính (tạo lớp, ghi danh, điểm danh, chấm bài, họp PH) có validate + toast + empty state.
- [ ] B: tạo phiếu thu, finalize payslip, workflow KPI, sửa cơ cấu lương — validate + toast + chặn lỗi server hiển thị rõ.
- [ ] C: nộp bài / đổi quà có validate + toast lỗi (vd hết sao) thay vì im lặng.
- [ ] D: tạo cơ sở/người dùng/khóa học/phụ huynh — validate + toast.
- [ ] Mỗi mảng: `pnpm typecheck` xanh; smoke E2E luồng chính (Playwright) nếu khả thi.

## Rủi ro & rollback

- Thay đổi `AppProviders` ảnh hưởng cả 4 app → verify build từng app sau F1.
- Thuần UI/feedback, không đụng schema/migration/auth → rollback = revert commit.
- Giữ public contract API nguyên vẹn; chỉ thêm hiển thị phía client.

## Files chính

- `packages/ui/src/provider.tsx`, `packages/ui/src/notify.ts` (mới), `packages/ui/src/index.tsx`, `packages/ui/package.json`
- `packages/ui/src/form.ts` (mới, F2)
- `apps/{admin,teaching,lms}/src/*.tsx` (A–D)
