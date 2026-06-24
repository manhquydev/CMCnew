# Rà soát định vị: LMS = "homework platform" vs spec Phase 2

> Lập 2026-06-24 (Opus, controller). Trigger: operator chốt **LMS = nơi HS làm bài tập về nhà + luyện thêm, KHÔNG phải học online; HS học chính trên lớp**. Yêu cầu: đối chiếu spec Phase 2, đề xuất feature giữ/đổi/bỏ (gồm certificate). Read-only — chưa code.

## Kết luận 1 dòng
**Spec Phase 2 vốn ĐÃ là homework platform — không cần đại phẫu.** Chỉ **Certificate** lệch định vị (và vốn luôn nằm ngoài Phase 2). Cần operator chốt số phận certificate + xác nhận giữ gamification.

## Bằng chứng: spec không giả định "học online"
- §0/§2.1–2.2: lõi = `Exercise` (đề PDF GV giao theo lớp) → `Submission` (HS annotate trên PDF) → `Grade` (GV chấm) → điểm + sao. Đây đúng "làm bài tập", không phải học online.
- **Không có** thực thể bài giảng video / khóa học nội dung / module tự học trong spec.
- Code khớp: routers chỉ `assessment, exercise, submission, grade, reward, badge, leaderboard, level-progress, notification, certificate` — **không** lesson/course-content/video. (kiểm kê `apps/api/src/routers/`)
- §1.2: `giao_vien` KHÔNG vào LMS; GV chấm ở app Teaching → LMS thuần phía HS/PH xem + làm bài.

→ Định vị operator **xác nhận** spec, không mâu thuẫn.

## Bảng feature ↔ định vị

| Feature LMS | Khớp "homework platform"? | Đề xuất |
|---|---|---|
| Exercise / Submission / annotation PDF | ✅ lõi | **GIỮ** |
| Grade + feedback + publish | ✅ lõi | **GIỮ** |
| QualitativeAssessment / FinalGrade / học bạ | ✅ — đánh giá kết quả làm bài + định tính | **GIỮ** |
| Dashboard HS/PH (điểm/bài/điểm danh/sao) | ✅ | **GIỮ** |
| Sao (`StarTransaction`) earn khi chấm xong | ✅ động lực làm bài (HS 3–11) | **GIỮ** (xác nhận) |
| Quà / redeem (atomic) | ✅ động lực | **GIỮ** (xác nhận) |
| Badge / Leaderboard | 🟡 gamification — hợp homework platform nhưng tùy ý | **GIỮ nếu** operator muốn động lực; bỏ nếu thấy thừa |
| LevelProgress (duyệt head_teacher) | 🟡 = cấp độ học vụ của HS (quyết trên lớp), surface ở LMS cho PH thấy | **GIỮ** (là bản ghi học vụ, không phải "học online") |
| **Certificate** (cấp tay + auto theo level-up) | ❌ artifact cấp bằng — đáng ngờ với homework platform; **vốn luôn "Ngoài Phase 2"** (spec §0, §5) | **CẦN CHỐT** (xem dưới) |

## Vấn đề Certificate (điểm quyết định)
**Hiện trạng code:** (a) `certificate.issue` cấp tay (head_teacher/quan_ly); (b) duyệt level-up **auto-tạo** 1 cert idempotent per student+level (`level-progress.ts:104-124`); (c) RLS chỉ staff đọc; (d) portal PH/HS chưa hiện cert.

**Vì sao lệch:** homework platform (HS học trên lớp, LMS chỉ làm bài) thường **không cấp chứng chỉ** — cấp bằng/chứng nhận là việc của nhà trường/khóa học, không phải nơi nộp bài tập.

**3 lựa chọn:**
1. **BỎ hẳn Certificate** — gỡ auto-cert khỏi level-up, ẩn/bỏ router + UI panel + model (migration archive). Sạch nhất nếu chắc không dùng. _(rủi ro: nếu sau cần lại thì khôi phục)_
2. **Giữ tối giản, BỎ auto** — giữ `certificate.issue` cấp tay cho trường hợp đặc biệt (vd hoàn thành chương trình), **gỡ coupling auto khỏi level-up**. Level-up chỉ đổi `Student.level`, không sinh cert.
3. **Định nghĩa lại** — certificate = "giấy khen hoàn thành" gắn động lực (vd hoàn thành X bài/đạt mốc sao), không phải bằng cấp. Hợp homework platform hơn nhưng là feature MỚI cần spec.

**Khuyến nghị:** **Phương án 2** (giữ cấp tay, gỡ auto khỏi level-up) — ít rủi ro, không mất khả năng, gỡ phần "auto cấp bằng" lệch định vị. Nếu operator chắc bỏ → phương án 1.

## Tác động nếu chốt (chưa làm, chờ duyệt)
- PA2: sửa `level-progress.ts` gỡ block auto-cert (104-124) + cập nhật test `level-up-certificate.int.test.ts` (đổi invariant: approve KHÔNG sinh cert); cập nhật spec §2.10 + comment schema. Lane: normal (đổi hành vi đã test) → int-test + review.
- PA1: thêm migration archive bảng certificate + gỡ router/UI. Lane: high-risk (xóa hành vi) → decision record + review.
- Gamification: nếu bỏ badge/leaderboard → gỡ tương ứng; nếu giữ → không đổi.

## Câu hỏi mở (cần operator chốt)
1. **Certificate:** PA1 bỏ hẳn / PA2 giữ cấp tay gỡ auto (khuyến nghị) / PA3 định nghĩa lại?
2. **Gamification (badge/leaderboard):** giữ làm động lực hay bỏ?
3. Sau khi chốt → tôi ghi `docs/decisions/NNNN-*.md` + cập nhật spec Phase 2 + roadmap Phase 5, rồi mới thực thi thay đổi code (giao ck agent Sonnet/Haiku).
