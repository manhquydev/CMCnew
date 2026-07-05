# Brainstorm: Chuẩn hóa mã lớp theo [cơ sở]-[chương trình]-[năm]-[số TT]

Date: 2026-07-04 | Status: agreed, not yet planned/implemented

## 1. Bối cảnh / yêu cầu gốc

User: chuẩn hóa cách sinh mã lớp học. 3 chương trình học (UCREA, Bright I.G, Black Hole)
đã list trong hệ thống khi sinh lớp. Đề xuất ban đầu: `[mã cơ sở]-[mã chương trình]-[số TT]`.
Yêu cầu phụ: liệt kê field tạo lớp hiện có để check nghiệp vụ.

## 2. Hiện trạng đã scout

- `Program` enum đã tồn tại global (`schema.prisma:30-34`): `UCREA`, `BRIGHT_IG`, `BLACK_HOLE` —
  đúng 3 giá trị user liệt kê, KHÔNG cần thêm data.
- `Course.code`: nhập tay tự do qua UI (`courses-panel.tsx`), không theo chuẩn — data test hiện
  tại `CRS_10512_5483`. Không dùng làm nguồn mã chương trình (xem quyết định §3).
- `Facility.code`: tự do, ngắn (vd `HQ`, `CS2`).
- `ClassBatch` (lớp học): mã hiện tại `B-{year}-{seq:0000}` (vd `B-2026-0007`), unique theo
  `(facilityId, code)`.
- Sinh mã: `packages/domain-academic/src/code.ts` (`formatBatchCode`, format+overflow guard) +
  `apps/api/src/services/batch-code.ts` (`nextBatchCode`, atomic qua `pg_advisory_xact_lock` +
  upsert `BatchCodeCounter`). Counter PK hiện tại: `(facilityId, year)`.
- Test atomic: `apps/api/test/batch-code-atomicity.int.test.ts`.
- Field khi tạo lớp (`classBatch.create`, `class-batch.ts:92-108`):

  | Field | Bắt buộc | Ghi chú |
  |---|---|---|
  | facilityId | ✅ | |
  | courseId | ✅ | → suy ra `course.program` |
  | name | ✅ | tự do |
  | startDate | optional | |
  | endDate | optional | phải sau startDate |
  | capacity | optional | |
  | slots[] | optional 0..n | dayOfWeek/startTime/endTime/roomId?/teacherId? |
  | code | server tự sinh | KHÔNG phải input |
  | status | server set = `planned` | |

  Không có field "chương trình" trực tiếp trên `ClassBatch` — suy ra qua `courseId → course.program`.

## 3. Quyết định đã chốt với user

1. **Nguồn mã chương trình**: dùng `Program` enum (3 giá trị cố định), KHÔNG dùng `Course.code`
   (Course.code chưa chuẩn hóa, sẽ là việc riêng nếu cần sau).
2. **Số thứ tự reset theo năm** (giữ logic hiện tại) — counter khóa theo
   `(facilityId, program, year)` thay vì `(facilityId, year)`.
3. **Có năm trong mã** để tránh trùng hình thức giữa các năm (số TT reset hàng năm nhưng mã
   không lộ năm → 2 lớp khác năm nhìn y hệt nhau, rủi ro nhầm lẫn khi tra cứu biên lai/chứng
   chỉ/audit log dài hạn).
4. **Viết tắt mã chương trình**: `UCREA→UCR`, `BRIGHT_IG→BIG`, `BLACK_HOLE→BH`.
5. **Lớp cũ giữ nguyên mã `B-YYYY-NNNN`** — chỉ áp dụng format mới cho lớp tạo MỚI sau khi đổi.
   Không backfill, không rename dữ liệu tham chiếu cũ (receipt/audit log/thông báo đang hiển thị
   mã lớp cũ vẫn đúng nguyên trạng).

## 4. Format cuối cùng

```
[mã cơ sở]-[viết tắt chương trình]-[YY]-[số TT 4 chữ số]
```

Ví dụ: `HQ-UCR-26-0001`, `CS2-BIG-26-0003`, `HQ-BH-27-0001`.

- `[mã cơ sở]` = `Facility.code` nguyên trạng (không transform).
- `[viết tắt chương trình]` = map cố định 3 giá trị (constant, không cần bảng DB):
  `UCREA→UCR`, `BRIGHT_IG→BIG`, `BLACK_HOLE→BH`.
- `[YY]` = 2 chữ số cuối năm (khớp style hiện tại đang dùng `startDate` year hoặc năm hiện tại
  nếu không có startDate — giữ logic cũ trong `class-batch.ts:115-117`).
- `[số TT]` = 4 chữ số, zero-pad (giữ nguyên style `formatBatchCode` hiện tại), overflow guard
  giữ >9999 → lỗi.

## 5. Thay đổi kỹ thuật cần thiết (khi lên plan)

- `BatchCodeCounter`: đổi PK từ `(facilityId, year)` → `(facilityId, program, year)`. Cần
  migration Prisma (drop+recreate composite key hoặc thêm cột `program` vào PK). Counter mới bắt
  đầu từ 0 cho mỗi `(facility, program, year)` — KHÔNG kế thừa số đếm cũ (dimension "program" chưa
  từng được track trước đây, nên không có gì để kế thừa).
- `formatBatchCode` / `nextBatchCode`: nhận thêm tham số `program`, thêm bước map
  `Program → viết tắt` (constant lookup trong `packages/domain-academic`).
- `advisory lock` key hiện dùng `(facilityId, year)` là 2 số nguyên — cần thêm chiều `program`
  vào lock key (advisory lock Postgres chỉ nhận 2 bigint hoặc 1 bigint; cần hash
  `program` thành số hoặc dùng lock theo 1 khóa duy nhất kết hợp cả 3 chiều — quyết định kỹ thuật
  khi implement, không phải quyết định nghiệp vụ).
- `classBatch.create` cần lấy `course.program` (đã join sẵn qua `courseId`) để truyền vào
  `nextBatchCode` — không cần thêm field input mới cho user.
- Ghi quyết định vào `docs/decisions/00XX-class-code-facility-program-format.md` (đổi mô hình dữ
  liệu + hành vi sinh mã hiện có = decision-worthy theo `FEATURE_INTAKE.md`), thêm dòng vào
  `docs/DECISION_INDEX.md` trỏ tới file này, match theo path `packages/domain-academic/src/code.ts`
  + `apps/api/src/services/batch-code.ts` + `packages/db/prisma/schema.prisma` (model
  `BatchCodeCounter`).

## 6. Vấn đề nghiệp vụ khác cần lưu ý (từ yêu cầu "check nghiệp vụ")

- `ClassBatch` không có field "chương trình" riêng — luôn suy ra qua `course.program`. Nếu sau
  này 1 khóa (`Course`) đổi `program` (không có API đổi hiện tại, nhưng không có constraint chặn
  ở DB), mã lớp cũ đã sinh sẽ KHÔNG tự cập nhật — chấp nhận được vì mã là snapshot tại thời điểm
  tạo, không phải derived field.
- `capacity`, `slots` là optional — lớp có thể tạo mà không có sĩ số/lịch học. Nếu nghiệp vụ yêu
  cầu bắt buộc (vd không cho lớp "planned" thiếu slot), đó là thay đổi validation riêng, ngoài
  phạm vi brainstorm mã lớp lần này.
- Không có giới hạn 1 khóa (`courseId`) không được trùng chương trình khác cơ sở — không liên
  quan mã lớp, chỉ note để user biết đang không bị chặn.

## 7. Chưa giải quyết / cần xác nhận thêm khi lên plan

- Thuật toán advisory-lock key cho 3 chiều (facility, program, year) — kỹ thuật thuần, sẽ quyết
  khi viết code, không cần user quyết định trước.
- Không có câu hỏi nghiệp vụ nào còn treo — tất cả quyết định cốt lõi đã chốt ở §3.

## Next steps

Sẵn sàng chuyển sang `/ck:plan` khi user xác nhận. Đề xuất `/ck:plan` (default, không cần TDD vì
đây là thay đổi format sinh mã mới cho record mới, không đụng behavior cũ của lớp đã tồn tại).
