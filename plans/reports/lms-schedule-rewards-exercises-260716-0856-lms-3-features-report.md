# Brainstorm — LMS: ẩn Schedule, đổi quà (ảnh+upload+seed), UX #exercises

- **Ngày:** 2026-07-16
- **Lane (đề xuất intake):** Normal, với 1 mảnh nghiêng High-risk (seed dữ liệu prod toàn cơ sở + endpoint upload mới). Chốt lane khi vào `/ck:plan`.
- **Nhánh:** develop
- **Quyết định chi phối:** `0038-session-level-exercises` (Accepted) — KHÔNG sửa; PA đã chọn tương thích tinh thần.
- **Trạng thái:** Đã chốt phương án, sẵn sàng chuyển plan.

---

## 1. Vấn đề & phạm vi

3 yêu cầu độc lập trên `apps/lms` + `apps/admin` + `apps/api`:

1. **Ẩn `/#schedule`** cho Phụ huynh (PH) và Học sinh (HS) trong LMS.
2. **Đổi quà**: đưa 21 ảnh quà vào dự án (đổi tên có cấu trúc), seed vào DB với `sao = số-trong-tên × 5`, và **thêm upload ảnh từ thiết bị** trong panel quản lý. Rà soát hệ thống đổi quà hiện có.
3. **UX `/#exercises`**: thay màn hình rỗng bằng ≤2 bài "sắp tới" + auto-scroll tới bài đang cần làm.

---

## 2. Hiện trạng (scout facts)

| Vùng | Sự thật trong code |
|------|--------------------|
| Schedule tab | Có ở cả `student-shell.tsx:34` (HS) và `parent-shell.tsx:25` (PH). Route qua hash; gõ tay `#schedule` vẫn vào dù xóa nav. Cần bỏ nav + guard hash + bỏ khỏi `ALL_*_TABS`. |
| Hệ đổi quà — backend | `apps/api/src/routers/rewards.ts` **đã đầy đủ**: giftCreate/Update/Archive, stockAdjust, starAdjust, redeem (khóa chống double-spend), review (hoàn sao), markDelivered. Model `Gift{ imageUrl, starsRequired, stock, facilityId }`. |
| Hệ đổi quà — UI | `apps/admin/src/rewards-panel.tsx` đủ chức năng. **Ảnh chỉ nhập URL** (`https://...`) — CHƯA có upload từ thiết bị. |
| Ai quản lý | Chỉ role **`giam_doc_kinh_doanh`** (`permissions.ts:265-272`). |
| Hạ tầng ảnh | `photo-store` (session evidence) content-addressed sha256, driver disk\|s3. Serve qua Hono: `POST /upload/session-photo` + `GET /files/session-photo/:ref` (`apps/api/src/index.ts:105,123`). Tái dùng được. |
| LMS static | `apps/lms/public/` (brand/, garden/) phục vụ file tĩnh. |
| #exercises | Render `ClimbView` (bản đồ leo dốc), gọi `exercise.listForPrincipal` → **chỉ trả bài ĐÃ MỞ** (`exercise.ts:141` trả `[]` nếu chưa buổi nào kết thúc ⇒ rỗng). Auto-scroll luôn xuống đáy (`climb-view.tsx:143-147`). `currentId` (bài đầu tiên chưa done) đã có sẵn. |
| 21 ảnh quà | Đọc được tại thư mục Downloads; tên chứa số sao (10→200). ×5 ⇒ dải 50→1000, đều nguyên. |

**Kết luận rà soát yêu cầu 2:** hệ đổi quà đã hoạt động end-to-end; chỉ thiếu (a) dữ liệu quà thật + ảnh, (b) upload ảnh từ thiết bị. Không xây lại.

---

## 3. Quyết định 0038 & cách hoà giải (yêu cầu 3)

**Luật 0038:** "Exercise visibility… derive from **ended** ClassSession — students only see work for lessons their class has **actually finished**."

Yêu cầu 3 muốn hiện bài của buổi **chưa** kết thúc → mâu thuẫn phần *visibility*. Đã trình bày trade-off; **user chọn PA A**:

- Hiện ≤2 node **khóa mờ**, KHÔNG lộ tên/nội dung bài — nhãn cố định "🔒 Bài tiếp theo — mở sau buổi học tới".
- Không lộ đề chưa dạy ⇒ **tương thích tinh thần 0038**, KHÔNG cần decision doc mới.
- Nộp bài vẫn bị `assertExerciseOpenForStudent` chặn (không đổi).

---

## 4. Phương án chốt

### YC1 — Ẩn Schedule (HS + PH)
- Bỏ item `schedule` khỏi `STUDENT_NAV` (`student-shell.tsx`) và nav PH (`parent-shell.tsx`).
- Bỏ `'schedule'` khỏi `ALL_STUDENT_TABS` và `ALL_PARENT_TABS` ⇒ hash `#schedule` rơi về mặc định (HS→`exercises`, PH→`overview`).
- Giữ `CurriculumSessionsTab` + case `schedule` trong view (dead-safe) hoặc dọn nếu không nơi nào khác dùng — xác nhận ở plan.
- Không đụng quyết định nào. Rủi ro thấp.

### YC2 — Đổi quà: ảnh + upload + seed
**(a) Đưa 21 ảnh vào dự án, đổi tên cấu trúc**
- Ingest 21 ảnh qua **photo-store** (content-addressed) để có 1 đường phục vụ duy nhất, `imageUrl` đồng nhất.
- Kèm bảng map tên-file → tên quà (chuẩn hoá dấu) để seed đọc số sao.

**(b) Endpoint ảnh quà** (nhân bản pattern session-photo)
- `POST /upload/gift-photo` — gated `giam_doc_kinh_doanh`, dùng `assertValidSessionPhoto`/store (tách dir `.data/gift-photos` hoặc tổng quát hoá store — chốt ở plan).
- `GET /files/gift-photo/:ref` — phục vụ catalog (không cần ownership per-student vì quà là danh mục facility công khai).

**(c) UI upload từ thiết bị**
- Thêm `FileInput`/file-picker vào `GiftCreateCard` + `GiftEditModal` (`rewards-panel.tsx`): chọn ảnh → upload → nhận ref → set `imageUrl`. Giữ ô URL làm phương án phụ.
- Edit quà đã hỗ trợ sửa **số sao** (`starsRequired`) + **thay ảnh** — chỉ bổ sung upload.

**(d) Seed dữ liệu**
- Script seed 21 quà với `starsRequired = số-trong-tên × 5`, `imageUrl` = ref ảnh đã ingest.
- **Phạm vi: PROD, TẤT CẢ facility đang có** (nhân bản 21 quà cho mỗi cơ sở; mỗi cơ sở tự quản tồn kho sau). Chạy dev trước để duyệt, rồi prod.
- Idempotent (tránh nhân đôi khi chạy lại) — vd upsert theo `(facilityId, name)`.

### YC3 — UX #exercises (PA A)
- API: thêm nguồn "upcoming" — ≤2 bài published của lesson HS đang enroll mà **buổi chưa kết thúc** (mirror `openedLessonIdsFor` cho buổi tương lai gần). Trả tối thiểu (id giả/đếm), KHÔNG kèm title/nội dung.
- `ClimbView`: render ≤2 node trạng thái `locked` phía trên `current`, nhãn mờ cố định, click không mở modal.
- Auto-scroll: đổi từ "xuống đáy" sang **cuộn tới node `current`** (bài đang cần làm / đang chờ chấm / đã chấm gần nhất) lần load đầu; giữ nguyên không giật khi refresh.
- Empty-state: khi không có cả bài mở lẫn sắp tới → thông báo thân thiện thay vì trống trơn.

---

## 5. Rủi ro & lưu ý

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Seed prod toàn cơ sở → nhân đôi/ sai facility | Idempotent upsert; chạy dev duyệt trước; log số bản ghi mỗi facility. |
| Ảnh upload ở prod container ephemeral | Dùng photo-store driver S3 ở prod (đã có sẵn seam), không ghi static. |
| Node khóa lộ nội dung → phạm 0038 | PA A: nhãn cố định, KHÔNG truyền title/desc/pdf ra client cho bài upcoming. |
| `listForPrincipal` đổi shape (thêm upcoming) | Giữ backward-compat: hoặc field riêng, hoặc query `upcoming` tách biệt để không phá client hiện tại. |
| Perm mới cho upload ảnh quà | Không tạo permission mới — tái dùng `rewards.giftUpdate`/`giftCreate` (cùng actor GĐKD). |

## 6. Tiêu chí nghiệm thu

- YC1: HS & PH không thấy mục "Lịch học & Nội dung"; gõ `#schedule` → rơi về mặc định, không lỗi.
- YC2: 21 quà hiển thị đúng ảnh + đúng sao (×5) trong tab "Đổi quà" của HS tại mỗi cơ sở; GĐKD tạo/sửa quà upload ảnh từ máy thành công, đổi sao + thay ảnh chạy được; HS đổi quà → duyệt → giao vẫn thông suốt.
- YC3: HS chưa mở bài nào vẫn thấy ≤2 node khóa mờ + thông báo; mở #exercises cuộn thẳng tới bài current; không lộ tên bài sắp tới; không nộp được bài khóa.

## 7. Câu hỏi mở (chốt khi plan)

- Prod: danh sách facilityId thật để seed (tra lúc chạy).
- Store ảnh quà: dùng chung dir với session-photo hay tách `.data/gift-photos`?
- Dọn hay giữ `CurriculumSessionsTab`/case `schedule` sau khi ẩn nav.
- `listForPrincipal` mở rộng field vs query `upcoming` riêng (backward-compat).
