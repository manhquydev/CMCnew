# 0008 LMS là nền làm bài tập; chứng chỉ cấp tay, bỏ auto theo level-up

Date: 2026-06-24

## Status

Accepted

## Context

Operator chốt định vị: **LMS = nơi học sinh làm bài tập về nhà + luyện thêm, KHÔNG phải học online**; học sinh học chính trên lớp. Trước đó duyệt level-up (head_teacher) **tự sinh** một `Certificate` ("Hoàn thành cấp độ X") trong cùng transaction (`level-progress.ts`). Với định vị "homework platform", việc tự cấp bằng/chứng nhận không phù hợp — cấp chứng chỉ là việc của nhà trường, không phải nơi nộp bài tập.

Rà spec Phase 2 (`docs/specs/phase-02-assessment-lms.md`) cho thấy phần còn lại của LMS **vốn đã khớp** định vị (bài tập PDF → nộp/annotate → chấm → điểm + sao); không có thực thể học-online. Chỉ certificate lệch, và nó vốn luôn được đánh dấu "Ngoài Phase 2".

## Decision

1. **Certificate chỉ cấp tay** qua `certificate.issue` (giam_doc_dao_tao / super_admin) cho trường hợp đặc biệt. **Gỡ auto-cấp khỏi luồng duyệt level-up**: duyệt level-up chỉ cập nhật `Student.level` + thông báo `level_up`, không sinh certificate.
2. **Gamification (badge + leaderboard) GIỮ** làm động lực làm bài cho học sinh.
3. Các feature LMS lõi khác (exercise/submission/annotation/grade/QualitativeAssessment/FinalGrade/sao/quà/level-progress) **giữ nguyên** — đã khớp định vị.

## Alternatives Considered

1. **Bỏ hẳn certificate** (gỡ model/router/UI). Loại: mất khả năng cấp chứng nhận thủ công khi cần; rủi ro khôi phục cao hơn lợi ích.
2. **Giữ nguyên auto-cert theo level-up.** Loại: trái định vị homework platform.
3. **Định nghĩa lại certificate = giấy khen động lực.** Hoãn: là feature mới cần spec riêng, chưa cần thiết.

## Consequences

Positive:

- Hành vi khớp định vị: LMS không tự cấp bằng.
- Vẫn giữ đường cấp tay cho nhu cầu thật, không phá schema.
- Tách bạch: level-up = bản ghi học vụ; certificate = hành động chủ động của lãnh đạo.

Tradeoffs:

- Đổi hành vi đã có test (`level-up-certificate.int.test.ts`) → phải lật invariant + cập nhật spec/schema comment.

## Follow-Up

- Gỡ block auto-cert trong `apps/api/src/routers/level-progress.ts`; sửa `student` thành non-binding update.
- Lật test: duyệt level-up KHÔNG sinh cert (đếm cert giữ 0); `certificate.issue` cấp tay vẫn tạo 1.
- Cập nhật `docs/specs/phase-02-assessment-lms.md` §2.10 + comment schema `Certificate`; roadmap Phase 5 (certificate = cấp tay, auto-gen dropped).
- Đăng ký durable: `harness-cli decision add`.
