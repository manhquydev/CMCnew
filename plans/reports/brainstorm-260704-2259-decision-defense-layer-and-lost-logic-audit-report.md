# Brainstorm — Lớp phòng thủ quyết định nghiệp vụ + rà soát mất mát logic

- **Ngày**: 2026-07-04
- **Nhánh**: develop
- **Trạng thái**: ĐÃ CHỐT THIẾT KẾ — chờ handoff `/ck:plan`

---

## 1. Vấn đề gốc (đã điều tra bằng bằng chứng, không suy đoán)

Bug rule #1 công ca ("chỉ tạo phiếu khi không còn phiếu Nháp/Chờ duyệt") tưởng là "logic đã chốt bị mất" — điều tra thực tế:

| Nguồn | Tìm thấy gì |
|---|---|
| `plans/260630-1919-work-shift-registration/reports/agent-01-business-logic.md` (brainstorm gốc) | Có state machine Draft→Submitted→Approved, nhưng **12 câu hỏi mở**, KHÔNG có rule khoá tạo phiếu |
| `.../reports/agent-03-api-design.md` (design cuối) | Code mẫu `create` **không có guard existence-check nào** |
| `git log -p` toàn bộ lịch sử `shift-registration.ts` | Dòng `status:'submitted'` (thiếu `draft`) được **thêm từ commit khởi tạo** — không phải bị ghi đè từ bản đúng trước đó |
| `docs/decisions/*` (34 file) | Không file nào nhắc rule này |

**Kết luận:** Rule này **chưa từng được viết thành văn bản chốt** — chỉ tồn tại như ý định miệng/trong đầu bạn, được code hoá một phần ngay từ đầu (thiếu nhánh `draft`). Không phải "mất do đè", mà là **chưa bao giờ có nguồn chân lý bằng văn bản để đối chiếu**. Khớp với cảnh báo cũ trong harness (intervention #7, 25/6): *"ck routing is ADVISORY — no hook enforces"*.

---

## 2. Thiết kế lớp phòng thủ (đã chốt theo lựa chọn của bạn)

**Không tạo hệ thống song song** — mở rộng cơ chế `docs/decisions/` + `harness-cli decision` đã có, thêm 2 việc:

### 2.1 `docs/DECISION_INDEX.md` — bảng tra nhanh grep-được
Một bảng phẳng, KHÔNG lặp lại nội dung quyết định (chỉ trỏ tới), format:

```markdown
| Module/File pattern | Rule (1 dòng) | Decision doc | Trạng thái |
|---|---|---|---|
| apps/api/.../shift-registration.ts (create/updateDates/submit) | 1 phiếu Nháp/Chờ duyệt tại 1 thời điểm; fromDate phải tương lai (Asia/Saigon) | docs/decisions/0035-shift-registration-ticket-lock.md | Active |
| apps/api/.../shift-registration.ts (approve) | Advisory-lock + supersede overlap cùng userId | docs/decisions/0020-work-shift-manager-ownership.md | Active |
| ... | ... | ... | ... |
```
Mục đích: agent grep 1 lần theo file path sắp sửa hoặc theo module, ra ngay list rule phải giữ — không cần đọc hết 34 file.

### 2.2 HARD RULE trong `AGENTS.md`/`CLAUDE.md` (được nạp mỗi phiên)
Thêm đoạn bắt buộc (không phải advisory):

> Trước khi sửa file có mặt trong `docs/DECISION_INDEX.md`, PHẢI đọc decision doc liên quan và trích lại rule trong response TRƯỚC khi code. Nếu thay đổi dự kiến mâu thuẫn với rule đã chốt → DỪNG, hỏi lại theo `review-audit-self-decision.md` (mục "User Decisions" đã có sẵn) thay vì tự quyết đổi.

### 2.3 Quy tắc cập nhật (đúng yêu cầu của bạn — không tự ý cập nhật)
- Index CHỈ được thêm dòng mới khi: (a) tạo decision doc mới theo hard-gate của `FEATURE_INTAKE.md`, hoặc (b) user xác nhận thay đổi quyết định cũ giữa chừng → tạo decision doc mới supersede + sửa dòng index trỏ sang bản mới (giữ bản cũ, không xoá — đúng tinh thần "vì sao contract thay đổi").
- Agent KHÔNG được tự suy diễn/thêm rule vào index nếu chưa có decision doc tương ứng.

### 2.4 Retrofit ngay
Tạo `docs/decisions/0035-shift-registration-ticket-lock.md` ghi lại chính xác rule vừa chốt hôm nay (khoá draft+submitted, ngày tương lai Asia/Saigon, updateDates) — đóng khoảng trống đã gây ra sự cố, biến nó thành ca đầu tiên trong index.

---

## 3. Audit toàn bộ 34 decision — phạm vi đã chốt: FULL

Đối chiếu từng file `docs/decisions/*.md` với code hiện tại, tìm decision nào **còn khớp** vs **đã lệch/mất** (giống ca vừa gặp: rule ghi 1 đằng, code chạy 1 nẻo).

**Cách triển khai đề xuất** (không phải code, là audit đọc-only → không vi phạm "brainstorm không implement"):
- Chia 34 decision thành ~6 nhóm theo domain (auth/RBAC, workflow/state-machine, payroll/tài chính, công ca/attendance, hạ tầng CI-CD, khác) để audit song song.
- Mỗi nhóm 1 agent: đọc decision doc → grep/đọc code hiện tại chỗ liên quan → kết luận KHỚP/LỆCH/KHÔNG-CÒN-ÁP-DỤNG + bằng chứng file:line.
- Output: 1 báo cáo tổng hợp `plans/reports/audit-...-decisions-vs-code-parity-report.md`, liệt kê mọi lệch pha tìm được — KHÔNG tự động fix (fix logic nghiệp vụ là việc high-risk, cần plan riêng + red-team như Plan A/B vừa làm).

**Việc này không cần `/ck:plan` (không sinh code)** — có thể chạy như 1 audit research dispatch ngay sau khi bạn duyệt thiết kế này, tách biệt khỏi việc build lớp phòng thủ (mục 2, cần `/ck:plan` vì có sửa `AGENTS.md`/`CLAUDE.md` — file luôn được nạp, cần cẩn trọng).

---

## 4. Next steps

1. `/ck:plan` cho việc build lớp phòng thủ (mục 2: DECISION_INDEX.md + sửa AGENTS.md/CLAUDE.md + retrofit decision 0035) → red-team (vì sửa file luôn-nạp) → validate.
2. Sau khi duyệt thiết kế, dispatch audit 34 decision (mục 3) song song — độc lập, không cần plan.
3. Nếu audit tìm thêm lệch pha → mỗi cái thành 1 brainstorm/plan riêng để fix (theo đúng pattern rủi ro cao vừa áp dụng cho Plan A/B).

## Câu hỏi còn mở
- Không có.
