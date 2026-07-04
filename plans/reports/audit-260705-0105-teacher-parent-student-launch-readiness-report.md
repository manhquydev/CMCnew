# Audit: teacher/parent/student launch readiness — process, not chỉ kết quả

**Ngày**: 2026-07-05 | **Branch**: develop | **Loại**: brainstorm/audit (không code mới, trừ 2 fix nhỏ đã chốt)

## Bối cảnh

User nêu 6 đầu mục nghi ngờ trước khi vận hành thật (dự án chưa hề chạy live cho GV/PH/HS), yêu
cầu kiểm tra **quy trình** tạo ra kết quả, không chỉ nhìn kết quả cuối. 6 agent Explore song song
đọc code (schema/router/permission/UI) cho từng mục; sau đó verify sống 2 vòng bằng browser thật
(Playwright/chrome-devtools MCP) cho mục nghi ngờ nhất.

## Kết quả từng mục

### 1. Tạo nhân sự mới → hồ sơ nhân sự — GAP THẬT (đã chốt fix)
- `EmploymentProfile` (`schema.prisma:1392`) đã có sẵn, khá đầy đủ (CCCD, position, startedAt,
  address, bank, employeeCode...), có UI riêng `StaffProfilePanel`.
- Nhưng `user.create` (`apps/api/src/routers/user.ts:77`) chỉ tạo `AppUser` (email/displayName/
  phone/roles/facility) — **không tạo `EmploymentProfile` row**, không ép buộc điền sau. 2 luồng
  tách rời hoàn toàn.
- Field còn thiếu ở mọi tầng: ngày sinh, giới tính, loại HĐ + ngày hết hạn, liên hệ khẩn cấp,
  BHXH/BHYT — **chấp nhận để sau** (xem quyết định bên dưới).

### 2. Tạo lớp + thêm học sinh — solid, 1 inconsistency thật (đã chốt fix)
- `class-batch.ts` + `batch-code.ts`: advisory lock + unique constraint theo facility+program, có
  test đua 15-way concurrent, migration `20260705010000` (facility+program scope) đang chạy đúng.
- 3 đường thêm HS vào lớp: `enrollment.enroll`/`enrollment.transfer` đều tính+trả `overCapacity`
  (cảnh báo mềm). Đường `receipt.approve` (đường tạo HS thật theo quyết định cũ) — **không tính
  overCapacity** (`finance.ts:895-922`) — nhồi vượt sức chứa qua đường tiền mà không cảnh báo.
- Không có test đua 2 `receipt.approve` cùng lúc vào 1 lớp (chỉ có test đua cho sinh mã lớp).

### 3. Email báo PH khi nhập học — nghi ban đầu là gap, USER XÁC NHẬN ĐÃ XONG
- Code path đúng: `receiptApprove` → `StudentAccount` → `enqueueEmail` (nếu có `parentEmail`) →
  outbox → Brevo (external)/Graph (internal) theo `email-routing.ts`.
- Scout + evidence local (`.env.production` không có dòng `BREVO_API_KEY`, journal
  `260703-0740` ghi "ships inert") gợi ý chưa xong — nhưng **user xác nhận trực tiếp: key đã set
  trên VPS (ngoài git) + đã gửi email PH thật thành công**. Chốt theo xác nhận của user, gạch khỏi
  danh sách gap.
- Nhánh phụ chưa xử lý (không thuộc phạm vi phiên này): `parentEmail` bỏ trống lúc thu tiền → im
  lặng không gửi gì; `lms_account_ready` fail thì không retry được (secret bị scrub).

### 4. GV upload ảnh buổi học + nhận xét HS — ĐÃ XONG, verify sống xác nhận
- `SessionEvidence`/`SessionEvidencePhoto`/`SessionStudentComment` (schema.prisma:399-452),
  `session-evidence.ts` router, `session-evidence-panel.tsx` UI — publish bị chặn cứng đến khi có
  summary + ≥1 ảnh + ≥1 comment.
- **Verify sống (2 vòng)**: đăng nhập GV thật (`giaovien@cmc.local`), mở panel, upload **2 ảnh
  JPEG thật** (không phải ảnh test 1x1) **chọn cùng 1 lần trong 1 file-picker** (multi-select),
  điền nhận xét, publish — thành công, không lỗi. Cả 3 ảnh (2 thật + 1 cũ) hiện đúng trong grid.
- UI đã có `FileInput multiple` (`session-evidence-panel.tsx:247`) + `uploadSelectedFiles()` loop
  từng file (`:129-139`) — **cơ chế multi-select đã tồn tại sẵn, không cần code thêm**.
- Friction nhỏ ghi nhận (không chặn): lần đầu `GET /files/session-photo/{ref}` trả 403 rồi
  browser tự retry ra 200 — có vẻ race thoáng qua, đáng để ý nếu tái diễn dưới tải thật.

### 5. PH xem ảnh + nhận xét buổi học — ĐÃ XONG, verify sống xác nhận
- `SessionEvidenceTab` (`apps/lms/src/session-evidence-tab.tsx`) hiển thị đúng ảnh+comment đã
  publish, scoped đúng theo con của PH (`listForPrincipal`, RLS + `assertOwnedStudent`).
- **Verify sống**: đăng nhập PH qua OTP thật (dev hint), vào "Điểm danh & buổi học" — thấy đúng 2
  ảnh JPEG thật GV vừa upload (khác nhau rõ ràng) + đúng nội dung nhận xét GV vừa nhập.
- Gap nhỏ, không chặn: chưa có loại notif riêng khi có evidence mới publish; `detailForPrincipal`
  tồn tại server nhưng UI không gọi (dead endpoint).

### 6. Trải nghiệm học tập HS (LMS) — ĐÃ XONG, không có chỗ giả/stub
- Luồng giao bài→nộp→chấm→điểm/sao/badge/leaderboard nối thật, autosave có version-conflict
  handling, empty/error/loading states đầy đủ, mobile responsive.
- Sau login (bao gồm cả phone-family-login PR#30 mới ship) HS vào thẳng tab "Bài tập" (climb view)
  — trải nghiệm data-driven thật, không phải placeholder.

## Quyết định đã chốt với user

| # | Vấn đề | Quyết định |
|---|---|---|
| A | Hồ sơ nhân sự không bắt buộc khi tạo | **Bắt buộc ngay lúc tạo**, field tối thiểu: CCCD + ngày vào làm + vị trí. Cơ chế: 1 form dài, 1 lần submit (mở rộng `UserCreateModal`, 1 mutation transactional tạo `AppUser`+`EmploymentProfile` cùng lúc). Field khác (DOB, HĐ, liên hệ khẩn cấp...) **để sau, không chặn**. |
| B | `receiptApprove` không tính overCapacity | **Fix cho đồng nhất** với `enrollment.enroll`/`transfer` — vẫn chỉ cảnh báo mềm, không chặn cứng (giữ đúng quyết định cũ về capacity). |
| C | Email PH qua Brevo | User xác nhận đã set key + gửi thành công thật trên prod — **đóng, không cần xử lý**. |
| D | Verify sống upload ảnh GV→PH | Đã chạy thật 2 vòng (ảnh test + ảnh thật multi-select) — **PASS cả 2**. |

## Implementation touchpoints (cho plan tiếp theo)

**A — Hồ sơ nhân sự bắt buộc:**
- `apps/api/src/routers/user.ts:77-174` (`user.create`) — mở rộng input schema, thêm tạo
  `EmploymentProfile` trong cùng transaction.
- `apps/admin/src/App.tsx:281-369` (`UserCreateModal`) — thêm field CCCD/startedAt/position vào
  form hiện tại.
- Không cần migration schema (3 field này đã tồn tại trong `EmploymentProfile`, chỉ cần validation
  bắt buộc ở app-layer).
- Không hồi tố cho nhân sự cũ đã tạo trước đó (chỉ áp dụng từ nay về sau — mặc định YAGNI, cần xác
  nhận lại nếu user muốn khác).

**B — overCapacity đồng nhất:**
- `apps/api/src/routers/finance.ts:884-887` — hiện chỉ `select: { facilityId: true }` từ
  `classBatch`, cần thêm `capacity: true`.
- Thêm đếm `activeCount` enrollment hiện tại của batch đó (giống pattern `enrollment.ts:126`) và
  trả `overCapacity` trong response của `receiptApprove` (hiện response ở `finance.ts:1089`).
- `apps/admin/src/finance-panel.tsx` — thêm hiển thị cảnh báo overCapacity giống
  `class-workspace.tsx:820` (`EnrollTab`) đã làm.

## Rủi ro / lưu ý

- A chạm "Public contracts" (input shape của `user.create` đổi, thêm field bắt buộc) + "Data
  model" (theo nghĩa business rule, không phải schema) + "Existing behavior" (đổi luồng tạo nhân
  sự) → theo `docs/FEATURE_INTAKE.md`, 3 cờ = lane **normal, validation mạnh hơn**, không phải
  high-risk (không chạm auth/authorization/data-loss thật).
- B là fix nhỏ, 1 cờ (existing behavior), có thể đi lane **tiny** nếu tách riêng khỏi A.
- A và B là 2 concern độc lập (HR domain vs Finance/Enrollment domain) — khuyến nghị 2 story/phase
  riêng, không gộp 1 luồng review.
- Friction 403-rồi-retry ở mục 4 chưa điều tra sâu (không thuộc phạm vi phiên này) — nếu tái diễn,
  cần xem lại race giữa upload-commit và file-serve.

## Câu hỏi còn mở

- A có cần áp dụng hồi tố cho nhân sự đã tạo trước đó không (hiện mặc định: không)?
- Field DOB/giới tính/loại HĐ/liên hệ khẩn cấp — có cần thêm vào schema ở đợt sau không, hay giữ
  nguyên phạm vi tối thiểu (CCCD+startedAt+position) vô thời hạn?
- 403-rồi-retry khi GET ảnh mới upload — điều tra ngay hay theo dõi thêm?

## Next steps

Đề xuất `/ck:plan` cho 2 phase độc lập (A: HR profile mandatory — normal lane; B: overCapacity
consistency — tiny/normal lane), không cần `--tdd` (không phải refactor logic nghiệp vụ phức tạp,
cả 2 đều additive).
