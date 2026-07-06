# Phase 2 — Đặc tả nghiệp vụ: Đánh giá & trải nghiệm LMS học sinh

> **Mục đích:** chốt nghiệp vụ TRƯỚC khi code (spec-first). Đây là **hợp đồng nghiệp vụ** — mọi schema/route bám đúng. Phát sinh mơ hồ MỚI khi build → DỪNG và hỏi.
> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-23) · Nguồn: `project-charter.md` §4–5 + kế thừa model hệ cũ (`grading.prisma`/reward) + 4 quyết định phỏng vấn + research kiến trúc annotate/lưu trữ.

## Tóm tắt quyết định đã chốt
- **Phạm vi:** spec bao trùm **toàn Phase 2**, nhưng **build theo lát cắt dọc**; slice đầu = `Exercise → nộp bài → GV chấm → cộng sao → redeem quà` (đúng done-evidence). Badge/leaderboard/level-progress/SSE-fanout/chat → slice Phase 2 sau.
- **Tài khoản HS/PH:** model **riêng** `StudentAccount` + `ParentAccount` (tách khỏi `AppUser` nhân sự), liên kết tới `Student`. **Phụ huynh là login chính**; HS có thể có login đơn giản (tùy chọn sau). Link PH↔HS qua bảng `Guardian` tối thiểu **ngay Phase 2**.
- **Chấm điểm:** kế thừa model hệ cũ đầy đủ — `Grade` 0–10/bài + threshold theo `GradingTemplate`; `QualitativeAssessment` (pillars + narrative + period); `FinalGrade` tổng hợp theo trọng số chương trình (UCREA 100% định tính / Bright I.G 60-40 / Black Hole 30-70); `LevelProgress` duyệt head_teacher.
- **Bài nộp = PDF + lớp annotation tách rời** (không lưu PDF phẳng mỗi vòng). **Build công cụ annotate tự** trên PDF.js (tham khảo Submitty/pdf-annotate.js), không SDK trả phí. Slice đầu: bộ annotate tối thiểu (ink + text + highlight).
- **Sao thưởng:** ledger `StarTransaction` (atomic); redeem qua `Reward` (PENDING→duyệt) + refund khi REJECTED; chống double-spend `WHERE stock>0` + advisory lock.
- **Realtime:** SSE cho thông báo/điểm/sao (thay polling).
- **Soft-delete/archive mọi nơi**; **RLS bắt buộc** trên mọi bảng tenant; giờ chuẩn ICT.

---

## 0. Phạm vi Phase 2

### Trong phạm vi
- **Cổng LMS** đăng nhập cho **Phụ huynh** (và HS tùy chọn).
- **Bài tập** (`Exercise`) do GV giao theo lớp + **nộp bài** (`Submission`) dạng PDF + lớp annotation.
- **Chấm điểm**: GV chấm bài (annotate + `Grade` 0–10 + feedback), `QualitativeAssessment` (định tính theo pillar), tổng hợp `FinalGrade`.
- **Dashboard học sinh** (điểm/bài tập/điểm danh/sao) + **Dashboard phụ huynh** (xem con: gradebook/học bạ).
- **Sao thưởng**: earn theo bài chấm xong + **Quà/redeem** (atomic).
- **Huy hiệu** (`Badge`) + **Leaderboard** (slice sau).
- **Level progress** + duyệt head_teacher (slice sau).
- **Thông báo realtime (SSE)** — bắt đầu với các sự kiện điểm/sao/bài mới; mở rộng dần tới 16 loại.

### Ngoài phạm vi Phase 2 (sang phase sau)
- Chat CSKH (FAQ + Gemini), chứng chỉ auto-gen, lịch họp PH cron → **Phase 5**.
- Đầy đủ 16 loại thông báo (Phase 2 làm tập con cốt lõi).
- Annotate nâng cao (stamp/hình học phức tạp, so sánh phiên bản) — sau bộ tối thiểu.
- CRM/Tài chính/Lương → Phase 3–4.

### Lộ trình build (slice dọc, mỗi slice chạy được + done-evidence thật)
- **S1 — Vertical cốt lõi:** đăng nhập PH → xem bài của con → HS/PH mở đề PDF, làm bài (annotate tối thiểu) → nộp → GV chấm (annotate + Grade) → HS/PH thấy điểm → **cộng sao** → **redeem quà** (atomic). *Done:* nộp→chấm→điểm+sao hiện realtime; redeem không double-spend.
- **S2 — Học bạ & tổng hợp:** `QualitativeAssessment` (pillars) + `FinalGrade` tổng hợp theo chương trình + dashboard PH gradebook/học bạ.
- **S3 — Gamification & tiến trình:** Badge + Leaderboard + Level progress + duyệt head_teacher.
- **S4 — Realtime mở rộng:** SSE fan-out đa loại thông báo + level progress notify.

---

## 1. Định danh HS/PH & truy cập

### 1.1 Model tài khoản
- **`StudentAccount`** — login tùy chọn cho học sinh; liên kết 1–1 tới `Student` (hồ sơ học vụ Phase 1). Trẻ 3–11 → đăng nhập đơn giản (mã/PIN), bật tùy chọn; **không bắt buộc** ở S1.
- **`ParentAccount`** — **login chính** của phụ huynh (email/SĐT + mật khẩu). Một PH có thể gắn **nhiều** HS.
- **`Guardian`** — bảng nối `ParentAccount ↔ Student` (quan hệ: bố/mẹ/người giám hộ), facility-scoped qua student. Tối thiểu ngay Phase 2 (sửa lỗ A3 hệ cũ — guardian thiếu UI/backend).
- Tách khỏi `AppUser` (nhân sự) để: (a) RLS/luồng auth khác biệt, (b) đúng ghi chú schema Phase 1 ("students & parents get their own models").

### 1.2 Auth & RBAC
- Role mới (ngoài 10 role nhân sự): `student`, `parent` — **chỉ truy cập app LMS**, không bao giờ vào Teaching/Admin.
- Phiên riêng (JWT + `tokenVersion`) như `AppUser`; thu hồi tức thì khi khóa tài khoản.
- **Phạm vi dữ liệu — RLS principal-aware** (đã chốt 2026-06-23, security-class): RLS facility hiện tại chỉ cô lập theo cơ sở — chưa đủ mịn cho PH↔con / HS↔chính mình. Bổ sung 2 GUC mỗi request: `app.principal_kind` (`staff`|`parent`|`student`, mặc định `staff` → tương thích ngược) + `app.student_ids` (uuid[]). Helper `app_principal_kind()`, `app_student_ids()`.
  - Policy trên bảng HS sở hữu: `super OR (principal='staff' AND facility=ANY(facility_ids)) OR (principal IN (parent,student) AND <student-link> = ANY(student_ids))`.
  - **Liên kết student theo bảng:** trực tiếp `student_id` (submission, reward, enrollment, star_transaction); `student.id` (bảng student); gián tiếp `grade`→submission, `attendance`→enrollment, `exercise`→enrollment-cùng-lớp, `notification`→`recipient_id`. Vì khác nhau nên **làm cùng router** để USING + WITH CHECK khớp luồng ghi (HS tự nộp bài/đổi quà; GV/system cộng sao).
  - `withRls` mở rộng nhận `principalKind?`/`studentIds?` (mặc định staff) — staff không đổi hành vi.
- `giao_vien` **không** vào LMS (charter bất biến); GV chấm bài ở app Teaching.

### 1.3 Bất biến tenancy
- Mọi bảng học vụ Phase 2 (`Submission`, `Grade`, `StarTransaction`, …) mang `facility_id` (kế thừa từ student/lớp) + RLS.
- PH/HS đọc xuyên facility **bị chặn**: phạm vi suy từ `Guardian`/`Student.facilityId`, resolve ở DB.

---

## 2. Thực thể & vòng đời

### 2.1 Exercise (Bài tập) — global lesson asset, mở theo buổi học
- Thuộc `CurriculumLesson` (session slot trong khung chương trình), không thuộc trực tiếp `ClassBatch`.
  Một unit 4 buổi có 4 lesson slots và có thể có 4 bài homework riêng.
- Trường chính: tiêu đề, mô tả, **đề gốc PDF** (1 file, content-addressed), loại
  (homework/test entrance/test periodic), điểm tối đa (mặc định 10), trạng thái draft/published/closed.
- Giám đốc upload/quản lý bài tập theo lesson slot. Học sinh chỉ thấy/nộp khi lớp của mình đã có
  `ClassSession.curriculumLessonId` tương ứng và buổi đó đã kết thúc. Giáo viên chấm bài trong ngữ cảnh
  lớp/buổi mình được phân công.

### 2.2 Submission (Bài nộp) — facility-scoped
- (exerciseId, studentId) — mỗi HS một bài/đề (cho phép nộp lại trước hạn → ghi version).
- **Không lưu PDF phẳng.** Nội dung = `answerText?` (DB) + **`annotationLayer` (JSON)**: nét ink/text/toạ độ HS vẽ lên đề gốc; tham chiếu `exercise.basePdfRef`.
- Trạng thái: `draft → submitted → graded`. `submittedAt`, có thể `unsubmit` trước hạn.

### 2.3 Document & Annotation storage (§ kiến trúc — xem §4)
- `exercise.basePdfRef` → MinIO/S3 (1 lần, dedup theo hash).
- `submission.annotationLayer` (HS) + `grade.annotationLayer` (GV) = lớp dữ liệu riêng. Render = gốc + lớp HS + lớp GV (PDF.js). **Flatten ra PDF chỉ khi xuất** (học bạ/lưu trữ), không lưu mặc định.

### 2.4 Grade (Điểm bài) — facility-scoped
- 1 `Grade` / `Submission`: `score` (0–`maxScore`, default 10), `feedback?`, `rubric?` (Json), `annotationLayer?` (GV chấm trên bài), `gradedBy`, `gradedAt`, `isPublished`.
- Publish điểm → HS/PH thấy + (nếu đủ điều kiện) **cộng sao** (§2.8) + bắn SSE.

### 2.5 GradingTemplate + GradingThreshold (cấu hình theo chương trình)
- `GradingTemplate`: program, level?, `formula` (Json — trọng số), `criteria` (Json — pillar định tính), thresholds.
- `GradingThreshold`: minPercent/maxPercent → `grade` (chữ) + `result` (đạt/chưa) + sequence. Seed theo 3 chương trình.

### 2.6 QualitativeAssessment (Đánh giá định tính)
- 1 / (studentId, period); `criteria` (Json `{pillar: score}`), `narrative?`, `period` (`MONTHLY` | `END_LEVEL`). GV/đầu chương trình chấm.

### 2.7 FinalGrade (Tổng hợp) — theo (student, program, level, period)
- Thành phần: `homeworkAvg`, `attendanceRate`, `testScore`, `qualitativeScore` → `finalScore`, `passed`.
- **Trọng số theo chương trình:** UCREA = 100% định tính; Bright I.G = 60% định tính + 40% định lượng; Black Hole = 30% định tính + 70% định lượng. Phần định lượng = blend homework/test/attendance theo `GradingTemplate.formula`.
- Tính idempotent theo khóa (student, program, level, period).

### 2.8 Sao thưởng (Rewards)
- **`StarTransaction`** (ledger): `amount` (±), `type` (`HOMEWORK_COMPLETED`|`GIFT_REDEEMED`|`GIFT_REJECTED_REFUND`|`MANUAL`), `reference` (submission/reward id). **Số dư = SUM(amount)** (không cột balance rời để tránh lệch).
- **Earn:** chỉ cộng khi bài **đã chấm có điểm** (charter: "chỉ cộng sao khi có điểm"). Mỗi sự kiện earn **idempotent** theo `reference` (không cộng 2 lần cùng submission).
- **`Gift`**: `starsRequired`, `stock` (-1 = vô hạn), gating `program?`/`minLevel?`.
- **`Reward`** (redeem): HS đổi sao lấy quà; `status` `PENDING → APPROVED|REJECTED`; REJECTED → hoàn sao (`GIFT_REJECTED_REFUND`).
- **Atomic chống double-spend:** trừ kho `UPDATE gift SET stock=stock-1 WHERE id=? AND (stock=-1 OR stock>0)` → 0-row = CONFLICT; trừ sao kiểm tra số dư trong cùng tx (advisory lock theo studentId). Sửa lỗi M2 hệ cũ.

### 2.9 Badge / Leaderboard (S3)
- `Badge` (unlockCriteria Json) + `StudentBadge` (unique student+badge). Cấp tự động theo tiêu chí hoặc GV cấp tay.
- Leaderboard: xếp theo sao/điểm trong phạm vi lớp/cơ sở (read-only).

### 2.10 LevelProgress (S3)
- `fromLevel → toLevel`, `status` `PENDING → APPROVED|REJECTED`, `proposedBy` (GV) → `approvedBy` (head_teacher). Audit/chatter đầy đủ.
- Duyệt chỉ cập nhật `Student.level` + thông báo `level_up`. **Không tự cấp chứng chỉ** — LMS là nền làm bài tập, không cấp bằng; chứng chỉ chỉ cấp tay qua `certificate.issue` (xem decision 0008).

### 2.11 Notification + SSE
- `Notification` (polymorphic: type, payload, recipient, read). Fan-out qua **SSE** tới HS/PH đang online. S1: sự kiện điểm/sao/bài mới; mở rộng dần.

### 2.12 Audit/Chatter
- Mọi mutation trạng thái (submit, grade, publish, redeem, level-up…) → ghi `record_event` (hạ tầng Phase 1). Không lưu PII nhạy cảm trong nội dung log.

---

## 3. Kiến trúc lưu trữ tài liệu & annotation (research-backed)

> Vấn đề: lưu mỗi vòng một PDF phẳng → dung lượng phình (đề × HS × vòng). Giải pháp theo chuẩn ngành (Kami/Google Classroom/Apryse/Submitty).

- **Đề gốc lưu 1 lần:** `Exercise.basePdfRef` → MinIO, **content-addressed** (key = hash) ⇒ đề trùng tự dedup.
- **Annotation = lớp dữ liệu riêng** (JSON: ink path/text/toạ độ/trang), KB thay vì MB:
  - `Submission.annotationLayer` (HS làm bài).
  - `Grade.annotationLayer` (GV chấm trên bài).
- **Render** = đề gốc + lớp HS + lớp GV (overlay trong PDF.js). Hai chiều: HS làm → GV chấm trên cùng nền.
- **Flatten → PDF** chỉ **khi xuất** (học bạ/lưu trữ/in), không lưu mặc định (dùng pdf-lib/Ghostscript ở backend).
- **Ước tính:** 30 HS/bài, mỗi bài 1 lớp HS + 1 lớp GV ⇒ phẳng ~61MB/bài → phân lớp ~2.2MB/bài (**~25–30×**).
- **Chặn phình đầu vào:** giới hạn size đề; nén ảnh trong PDF khi upload (Ghostscript/qpdf); đơn giản hoá nét ink; cap payload annotation.
- **Tech:** PDF.js (render, Apache-2.0) + lớp annotate canvas tự xây (tham khảo Submitty `pdf-annotate.js`). Không SDK trả phí. Lưu lớp dạng JSON (DB cho payload nhỏ / MinIO nếu lớn).

---

## 4. Bất biến kỹ thuật
- RLS + policy trên **mọi** bảng có `facility_id` + test cô lập (PH/HS không xem được con/HS cơ sở khác).
- Logic nặng (công thức điểm, tổng hợp FinalGrade, số dư sao, unlock badge) → `packages/domain-grading` + `packages/domain-rewards` **thuần**, test độc lập.
- Earn sao **idempotent** theo `reference`; redeem **atomic** (0-row = CONFLICT) + advisory lock.
- Số dư sao = SUM(ledger), không cache cột rời.
- File: đề gốc dedup theo hash; annotation tách lớp; flatten chỉ khi xuất.
- Mọi mutation trạng thái → audit/chatter (bắt buộc).
- Giờ chuẩn ICT; soft-delete/archive, không xóa cứng.

---

## 5. Bảng quyết định (khóa schema)

| Mục | Quyết định |
|---|---|
| Phạm vi | Spec cả Phase 2; build theo slice S1→S4; S1 = submit→grade→star→redeem |
| Tài khoản HS/PH | Model riêng `StudentAccount`/`ParentAccount`; PH login chính; `Guardian` tối thiểu ngay |
| Role | + `student`, `parent` — chỉ LMS; GV không vào LMS |
| Phạm vi dữ liệu | **RLS principal-aware** (GUC `app.principal_kind`+`app.student_ids`): staff→facility, parent/student→student ownership; chặn xuyên facility + PH↔PH. Làm cùng router để khớp WITH CHECK |
| Bài nộp | PDF đề gốc 1 lần + **annotation lớp riêng** (JSON); không lưu PDF phẳng |
| Annotate tool | **Build tự** trên PDF.js (Submitty ref); S1 tối thiểu ink+text+highlight |
| Lưu trữ | MinIO content-addressed (dedup); flatten chỉ khi xuất |
| Chấm điểm | Kế thừa hệ cũ: Grade 0–10 + template/threshold; QualitativeAssessment (pillars); FinalGrade tổng hợp UCREA 100/0 · BI 60/40 · BH 30/70; LevelProgress duyệt head_teacher |
| Sao | Ledger `StarTransaction` (số dư=SUM); earn khi đã chấm + idempotent; redeem atomic (sửa M2) |
| Realtime | SSE; S1 điểm/sao/bài mới, mở rộng dần |
| Ngoài Phase 2 | Chat CSKH, chứng chỉ, họp PH cron → Phase 5 |
