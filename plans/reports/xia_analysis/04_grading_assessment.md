# Feature Comparison: Grading & Assessment (Chấm điểm & Học bạ)
## Source: https://github.com/openeducat/openeducat_erp (op_exam, op_marksheet)
## Local Project: cmc_source (packages/domain-grading, apps/api/src/routers/assessment.ts)

Ngày: 2026-06-26 · Mode: `xia --compare` (research-only, đối chiếu nghiệp vụ)

---

## 0. Kết luận thẳng (TL;DR)

Mô hình chấm điểm của CMC vượt trội hơn OpenEduCat ở khả năng **tự động hóa và pha trộn định tính/định lượng (Mixed Grading) theo chương trình học (UCREA / Bright I.G / Black Hole)**. 
- **OpenEduCat (Odoo)** vận hành theo tư duy trường học truyền thống (Subject-based / Exam-centric): thu thập điểm số các môn thi (`op.result.line`), tính trung bình hoặc GPA, rồi ánh xạ qua thang điểm chữ (`op.grade.scale`). Khả năng đánh giá định tính chỉ nằm ở mô-đun Enterprise thông qua Rubric bài tập, không hỗ trợ công thức tổng hợp định tính + định lượng theo từng chương trình cụ thể.
- **CMC** thiết kế mô hình **Program-based / Competency-centric**: phân chia rõ rệt trọng số định tính (QualitativeAssessment qua pillars: sáng tạo, làm việc nhóm...) và định lượng (Grade bài tập/test + điểm danh tự động). Điểm số được tổng hợp tự động (`computeFinalGrade`) dựa trên khoảng ngày của kỳ học (`AcademicTerm`).

**Khuyến nghị:** Giữ nguyên và củng cố kiến trúc `@cmc/domain-grading` của CMC. Đây là điểm sáng thiết kế độc lập, sạch, và có đơn vị kiểm thử (112 unit tests). Không nên lai ghép mô hình cồng kềnh của OpenEduCat. Tuy nhiên, CMC có thể học hỏi OpenEduCat trong việc cấu hình linh hoạt Grade Scales thông qua cơ sở dữ liệu thay vì hardcode một số hằng số.

---

## 1. Hiện trạng CMC (Grading & Assessment)

Hệ thống chấm điểm của CMC được chia thành 2 phần: package domain thuần `@cmc/domain-grading` (chứa logic tính toán) và tRPC router `assessment.ts` (truy vấn DB và lưu trữ).

### 1.1 Luồng dữ liệu & Mô hình dữ liệu
- **`GradingTemplate` (`grading_template`)**: Cấu hình theo từng cơ sở (`facilityId`), chương trình (`program`) và cấp độ (`level`).
  - `formula` (JSON): Trọng số định lượng `{ homework, test, attendance }`.
  - `criteria` (JSON): Mảng các pillar định tính (ví dụ: `["creativity", "teamwork", "focus"]`).
- **`GradingThreshold` (`grading_threshold`)**: Bảng tra cứu quy đổi từ `%` điểm chung cuộc sang điểm chữ (`grade`: A, B, C...) và nhãn kết quả (`result`: Đạt/Chưa đạt).
- **`Grade` (`grade`)**: Điểm một bài nộp (`Submission`) của học sinh (thang 0..10), được chấm bởi giáo viên và chỉ được tính khi `isPublished = true`.
- **`QualitativeAssessment` (`qualitative_assessment`)**: Đánh giá định tính của giáo viên cho từng học sinh theo kỳ học (`periodKey`). Lưu trữ các điểm số pillar (0..10) trong `criteria` JSON (ví dụ: `{ creativity: 8, focus: 6 }`) và nhận xét `narrative`.
- **`FinalGrade` (`final_grade`)**: Bảng tổng hợp lưu trữ kết quả cuối kỳ (`homeworkAvg`, `attendanceRate`, `testScore`, `qualitativeScore`, `finalScore`, `passed`, `complete`).
- **`AcademicTerm` (`academic_term`)**: Kỳ học có ngày bắt đầu và kết thúc. Quyết định mốc thời gian để lọc điểm `Grade` và `Attendance` khi tính điểm tổng hợp (`computeFinalGrade` mutation).

### 1.2 Công thức Blending (Mixed Grading)
CMC định nghĩa 3 công thức trọng số pha trộn theo chương trình (`programWeights` trong `grading.ts`):
- **UCREA**: 100% Qualitative (định tính) / 0% Quantitative (định lượng).
- **BRIGHT_IG**: 60% Qualitative / 40% Quantitative.
- **BLACK_HOLE**: 30% Qualitative / 70% Quantitative.

Phần định lượng được blend từ `homeworkAvg`, `testScore` và `attendanceRate` (quy đổi 0..1 về thang điểm 10) dựa trên trọng số trong `GradingTemplate.formula`. Đặc biệt, CMC hỗ trợ **tự động chuẩn hóa lại trọng số (Renormalize)** khi thiếu một trong các thành phần (ví dụ: chưa có bài test nào thì tổng trọng số định lượng sẽ chia cho `homework + attendance`).

### 1.3 Trạng thái Provisional (Bán hoàn thành)
If một thành phần có trọng số > 0 bị thiếu (ví dụ: chưa có QualitativeAssessment cho kỳ học), `complete` sẽ là `false` (điểm tạm thời/provisional). Hệ thống vẫn tính toán điểm dựa trên các phần đã có nhưng đánh dấu chưa hoàn thiện để hiển thị trên dashboard phụ huynh.

---

## 2. Mô hình OpenEduCat (Exam & Marksheet)

OpenEduCat (Odoo) quản lý việc đánh giá học tập thông qua 2 mô-đun: `openeducat_exam` (Community) và `openeducat_grading` (Enterprise).

### 2.1 Cấu trúc thực thể (Community)
- **`op.exam.session`**: Kỳ thi tập trung (ví dụ: Học kỳ 1).
- **`op.exam`**: Kỳ thi cụ thể của một môn học (Subject) trong session đó. Định nghĩa điểm tối thiểu/tối đa (`min_marks`, `max_marks`).
- **`op.exam.attendees`**: Danh sách học sinh tham gia phòng thi, lưu điểm raw (`marks_get`) và trạng thái có mặt.
- **`op.marksheet.register`**: Bản ghi quản lý việc xuất học bạ cho cả kỳ thi.
- **`op.marksheet.line`**: Bảng điểm của một học sinh trong register đó.
- **`op.result.line`**: Chi tiết điểm từng môn thi của học sinh, chứa điểm số (`marks`), phần trăm, trạng thái Đạt/Trượt (`status`), và điểm chữ được quy đổi.

### 2.2 Quy đổi định tính (Grade Scales)
- OpenEduCat sử dụng **Grade Scale** (`op.grade.scale`) chứa danh sách các khoảng phần trăm (`min_per`, `max_per`) tương ứng với điểm chữ (`grade` như A, B, C) và điểm GPA tích lũy.
- Khi nhấn nút "Generate Result" trên `op.result.template`, Odoo sẽ quét toàn bộ điểm thi của học sinh, tính phần trăm/GPA, rồi tự động gán điểm chữ dựa trên cấu hình Grade Scale.

### 2.3 Mô hình Enterprise (`openeducat_grading`)
- Chuyển từ quản lý kỳ thi sang quản lý Assignment và Gradebook (`gradebook.gradebook`, `gradebook.line`).
- Cho phép đánh giá bằng Rubric định tính trên từng bài tập. Giáo viên chấm theo thang đo tiêu chuẩn (ví dụ: 4 mức độ của Marzano), sau đó hệ thống ánh xạ các mức độ này thành điểm số để đưa vào bảng điểm Gradebook chung.

---

## 3. Head-to-Head Comparison (So sánh chi tiết)

| Khía cạnh | OpenEduCat (Source) | CMC (Local) | Đánh giá & Khuyến nghị |
| --- | --- | --- | --- |
| **Triết lý đánh giá** | **Môn học & Kỳ thi (Subject-centric)**. Điểm gom từ các bài thi viết cụ thể rồi tính tổng/GPA. | **Chương trình & Năng lực (Program-centric)**. Điểm gom từ quá trình (LMS homework/test/attendance) kết hợp đánh giá định tính của giáo viên. | **CMC phù hợp hơn**. Đặc thù học sinh 3-11 tuổi cần đánh giá năng lực toàn diện (pillar) hơn là thi cử học thuật nặng nề kiểu OpenEduCat. |
| **Pha trộn Định tính/Định lượng** | Không hỗ trợ pha trộn trực tiếp theo tỷ lệ cố định. Đánh giá định tính chỉ được tính bằng cách quy đổi điểm Rubric ra điểm số rồi cộng dồn. | Hỗ trợ tuyệt đối qua **Program Weights (100/0, 60/40, 30/70)**. Tự động blend điểm số LMS và đánh giá hành vi của GV. | **CMC vượt trội**. Thuật toán blend trong `domain-grading` rất thanh thoát và giải quyết đúng bài toán mixed-grading của CMC. |
| **Xử lý thiếu dữ liệu (Provisional)** | Tính toán lỗi hoặc cho ra kết quả sai lệch nếu thiếu cột điểm. Không có cơ chế tự quy đổi/chuẩn hóa lại trọng số khi thiếu thành phần. | **Tự động chuẩn hóa lại (Renormalize)** trọng số dựa trên các thành phần thực tế đang có. Đánh dấu `complete: false` cho điểm provisional. | **CMC vượt trội**. Giúp phụ huynh xem được điểm tiến trình liên tục trên ứng dụng mà không cần chờ đến cuối kỳ khi GV nhập đủ điểm. |
| **Gom nhóm theo thời gian** | Thủ công thông qua việc gán các môn thi vào `op.exam.session`. | Tự động hóa qua khoảng thời gian `startDate` - `endDate` của **`AcademicTerm`** tương ứng với `periodKey`. | **CMC tối ưu hơn**. Giảm thiểu sai sót cấu hình thủ công của giáo viên, tự động gom điểm danh và bài nộp đúng kỳ học. |
| **Cấu hình Thang điểm (Thresholds)** | Rất linh hoạt qua UI/DB của Odoo. Hỗ trợ nhiều loại thang điểm cho từng quốc gia khác nhau. | Có bảng `GradingTemplate` và `GradingThreshold` trong DB. Tuy nhiên, tỷ lệ pha trộn chương trình (100/0, 60/40, 30/70) vẫn đang hardcode trong code. | **Ngang nhau**. CMC đã lưu template ở DB nhưng nên cân nhắc chuyển hẳn program weights vào `GradingTemplate` DB để tăng tính tùy biến. |
| **Kiến trúc mã nguồn** | Ràng buộc chặt chẽ vào Odoo ORM (Python), khó viết unit test độc lập cho logic tính điểm mà không khởi động DB/Server Odoo. | **Decouple hoàn toàn**. Logic tính toán nằm ở `@cmc/domain-grading` là TypeScript thuần, chạy test độc lập cực nhanh (vitest). | **CMC vượt trội**. Bảo đảm code sạch, dễ bảo trì, đúng nguyên tắc bất biến số 2 của dự án. |

---

## 4. Khuyến nghị triển khai cho CMC

### 4.1 Giữ nguyên cốt lõi (Core Preservation)
- Tuyệt đối **không chuyển đổi** sang mô hình thực thể cồng kềnh (`exam.session`, `exam.attendees`) của OpenEduCat. Luồng chấm điểm hiện tại của CMC dựa trên `Submission` -> `Grade` là rất tinh gọn và phù hợp với mô hình LMS tự học của học sinh.
- Tiếp tục duy trì và mở rộng bao phủ kiểm thử cho package `@cmc/domain-grading`.

### 4.2 Cải tiến cấu hình (Architectural Improvements)
- **Chuyển đổi Program Weights vào DB**: 
  - Hiện tại, tỷ lệ pha trộn (UCREA 100/0, BRIGHT_IG 60/40, BLACK_HOLE 30/70) đang được khai báo cứng ở file `grading.ts` (`programWeights` function).
  - Khuyến nghị: Thêm các cột `qualitativeWeight` và `quantitativeWeight` vào bảng `GradingTemplate` trong Prisma. Khi tRPC router `assessment.ts` gọi `computeFinalGrade`, nó sẽ lấy cấu hình này từ database truyền vào.
  - Mục đích: Giúp Ban giám đốc / Quản lý có thể điều chỉnh tỷ lệ pha trộn điểm của các chương trình qua màn hình Admin mà không cần sửa code/deploy lại hệ thống.
- **Enforce Lịch họp phụ huynh theo Kỳ học**:
  - Theo project charter, UCREA yêu cầu 5 buổi/tháng, Bright I.G + Black Hole yêu cầu 3 buổi/tháng.
  - Hiện tại logic này chưa được enforce trong code. Có thể bổ sung cột `requiredMeetingsCount` vào `GradingTemplate` hoặc `AcademicTerm` để làm cơ sở cảnh báo/kiểm tra tính hoàn thành của kỳ học.

---

## 5. Câu hỏi chưa giải quyết (Unresolved Questions)

1. **Chuyển lớp/chương trình giữa kỳ:** Nếu một học sinh chuyển chương trình học giữa kỳ (ví dụ: chuyển từ UCREA sang BRIGHT_IG), hệ thống sẽ tính FinalGrade như thế nào khi bảng `final_grade` có unique constraint trên `[studentId, program, periodKey]`? Học sinh sẽ có 2 dòng điểm độc lập hay điểm cũ sẽ bị lưu trữ?
2. **Quy trình khóa điểm cuối kỳ:** Có cần cơ chế "Khóa kỳ điểm" để ngăn giáo viên sửa điểm `Grade` cũ sau khi `FinalGrade` đã được head_teacher duyệt và phát học bạ hay không? Hiện tại chưa có trường `isLocked` trên `AcademicTerm` hay `FinalGrade`.
3. **Cơ chế Trigger tự động:** Hiện tại `computeFinalGrade` là một tRPC mutation được gọi thủ công (hoặc qua UI sự kiện). Có nên thiết lập một cron job tự động chạy tính toán lại điểm tổng hợp hàng đêm cho học sinh có thay đổi về điểm danh hoặc bài chấm mới trong kỳ để cập nhật nhanh hiển thị của phụ huynh không?
