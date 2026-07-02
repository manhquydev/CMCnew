# Plan: Khóa tầng mây theo buổi học đã diễn ra

Status: DRAFT — chờ duyệt trước khi implement (đụng schema + đổi nghiệp vụ đã chốt trước đó)
Lane: **high-risk** (data model + existing behavior change + multi-domain: academic + LMS)
Ngày: 2026-07-01 | Nhánh: develop

## Bối cảnh

Hiện tại `apps/lms/src/climb-view.tsx` chủ động để TẤT CẢ bài tập luôn mở (comment: "homework is
never hard-locked" — quyết định nghiệp vụ trước đó). User giờ xác nhận nghiệp vụ thật khác:

> Mỗi bài = 1 tầng mây. Bài tương ứng buổi học nào chỉ mở SAU KHI buổi học đó đã diễn ra. Học
> viên vào lớp muộn (không học từ đầu) mặc định vẫn được mở đầy đủ các bài mà lớp đã mở tới thời
> điểm hiện tại — không bị "học lại từ đầu" như học sinh mới, và không bị coi là ngang hàng với
> bạn học từ đầu (tức: mốc mở bài là thuộc về LỚP theo tiến độ buổi học, không phải theo ngày
> học viên ghi danh).

## Kết quả scout (đã xác nhận, không phải giả định)

- `Exercise` (`packages/db/prisma/schema.prisma:568-590`) chỉ có `classBatchId` — **chưa có**
  liên kết tới `ClassSession` nào.
- `ClassSession` (`schema.prisma:294-317`) có `sessionDate`, `status: SessionStatus`
  (`planned|confirmed|cancelled` — **không có `completed`**). "Đã diễn ra" phải suy ra từ
  `sessionDate` (+ `endTime`) so với thời điểm hiện tại, không dựa vào status.
- `Enrollment.createdAt` (`schema.prisma:334`) là timestamp ghi danh — dùng làm proxy "học viên
  vào lớp khi nào" nếu cần, nhưng **theo đúng nghiệp vụ đã chốt, KHÔNG dùng field này để gate
  khóa** (tránh học viên vào muộn bị khóa lại từ đầu).
- `exercise.listForPrincipal` (`apps/api/src/routers/exercise.ts:26-36`) hiện chỉ lọc theo
  `status/archivedAt`, không join `ClassSession`.
- **Kết luận: cần migration** — thêm quan hệ Exercise ↔ ClassSession.

## Thiết kế đề xuất

1. **Schema**: thêm `Exercise.classSessionId` (nullable FK → `ClassSession`, có index). Nullable
   để không phá exercise cũ chưa gắn buổi học (fallback: exercise không có `classSessionId` luôn
   mở, giữ hành vi hiện tại cho dữ liệu legacy).
2. **Unlock rule** (tính ở tầng domain, không phải per-student):
   `unlocked = exercise.classSessionId === null || exercise.classSession.sessionDate <= now()`.
   Tính theo **lớp** (batch + session date), KHÔNG theo `Enrollment.createdAt` — tự động thỏa
   yêu cầu "học viên vào muộn thấy full tiến độ lớp" vì không hề nhìn vào ngày ghi danh.
3. **API**: `exercise.listForPrincipal` trả thêm field `locked: boolean` (tính theo rule trên).
   Không đổi shape hiện có, chỉ thêm field — public contract mở rộng, không breaking.
4. **UI**: `climb-view.tsx`/`cloud-climb.tsx` — node có `locked=true` hiển thị mờ + icon khóa
   (đã có `IconLock` sẵn trong showcase, tái dùng), không cho mở modal làm bài.
5. **Giáo viên tạo bài**: form tạo exercise (nơi đang chọn `classBatchId`) cần thêm chọn
   `classSessionId` (optional) — cần xác định UI đó nằm ở đâu (admin/teaching exercise-create).

## Câu hỏi cần chốt thêm trước khi code

1. Exercise cũ (đã tồn tại, không gắn buổi học) — giữ **luôn mở** (theo đề xuất ở trên) hay ẩn
   luôn tính năng khóa cho tới khi giáo viên gán buổi học cho từng bài?
2. Giáo viên tạo bài tập ở đâu hiện nay (file cụ thể) — cần tôi scout thêm UI đó trước khi sửa
   form, hay bạn đã biết rõ?
3. Có cần backfill dữ liệu cũ (gán `classSessionId` cho exercise hiện có theo `dueAt` gần nhất
   với `sessionDate` nào đó) hay để trống hết, giáo viên gán dần từ nay về sau?

## Phạm vi KHÔNG làm (YAGNI)

- Không đổi enum `SessionStatus` để thêm `completed` — dùng `sessionDate` so với `now()` là đủ,
  giữ enum ổn định (tránh migration enum tốn kém + ảnh hưởng chỗ khác dùng enum này).
- Không hard-lock theo Enrollment — đã quyết ở trên.

## Rủi ro

- Migration thêm field nullable — an toàn, không cần backfill bắt buộc, rollback dễ (drop
  column). Không đổi enum, không đổi RLS.
- Risk chính là UX: nếu giáo viên quên gán `classSessionId`, bài đó mặc định mở (an toàn, lệch
  về phía "mở nhầm" thay vì "khóa nhầm" — chấp nhận được vì đúng tinh thần "never hard-locked"
  cũ làm baseline an toàn).

## Chưa implement — chờ trả lời 3 câu hỏi ở trên.
