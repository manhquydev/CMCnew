# Rubric KPI thực tế CMC — trích từ 2 file Excel gốc (2026-06-25)

> Nguồn: `Mẫu đánh giá KPI -kinh doanh.xlsx`, `Mẫu KPI TNGV,GIÁO VIÊN.xlsx` (giải nén sharedStrings).
> Mục đích: cung cấp dữ liệu thật để thiết kế P05 (KPI giáo viên) + P06 (KPI sale).

## Phát hiện then chốt (đổi thiết kế)

**KPI thực tế của CMC = BIỂU MẪU ĐÁNH GIÁ của quản lý, KHÔNG phải tính tự động hoàn toàn.**
- Mỗi tiêu chí chấm thang **1–5 điểm**, có 3 cột: **N tự đánh giá → N+1 (quản lý trực tiếp) →
  N+2 (cấp trên)**. Có cột **TỶ TRỌNG (HR)** cho từng tiêu chí.
- Phần lớn tiêu chí là **chủ quan** (thái độ, trách nhiệm, hợp tác, hài lòng PH) — không auto được.
- Chỉ vài chỉ số **định lượng** auto được: tỷ lệ tái tục, số cuộc gọi >5s, điểm tiến bộ HS (điểm
  kiểm tra), tỷ lệ chốt deal, số check-in.
→ Mô hình "auto + override + audit" (decision 0011) đã build là ĐÚNG hướng; nhưng "auto hoàn toàn"
  không khớp tài liệu. Nên dựng **biểu mẫu KPI có trọng số + chấm 1–5**, auto-prefill các ô định lượng.

## Xung đột phát hiện (cần chốt)

1. **Band xếp loại KPI sale**: file Excel ghi **A 90-100 · B 80-<90 · C 60-<80 · D <60** (4 bậc).
   Còn docx (đã build ở P01) ghi 5 bậc A90/B70/C50/D40/E. → Hai nguồn lệch. P01 hiện theo docx.
2. **Band khác cũng xuất hiện** trong cùng file (70-<90, <70) ở bảng khác → nội bộ file không nhất quán.

## KPI Sale — "Chuyên viên tuyển sinh" (CVTV)

Tiêu chí (cột CHỈ TIÊU + TỶ TRỌNG, chấm theo KẾT QUẢ):
- **Kết quả kinh doanh:** Số tuyển sinh · Doanh thu dòng tiền
- **Chỉ số kinh doanh:** Trial Actual (tỷ lệ chốt deal **≥30%**) · **Số cuộc gọi (40 call >5s / 1 ca
  làm việc)** · Số check-in/tuần (**5 ci/tuần**)
- **Tuân thủ**

→ Xác nhận luật cuộc gọi: **40 cuộc >5s mỗi ca** (Callio billDuration>5s đã đúng). Telesales CTV:
  đơn giá 15.000đ/giờ + thưởng KPI 20.000đ/khách check-in thành công (tối thiểu 10 khách/tháng).

## KPI Giáo viên — "Giáo viên/trợ giảng"

Tiêu chí (cột ĐIỂM TỶ TRỌNG):
- **Công tác giảng dạy:** quản lý lớp (chuẩn bị trước/trong/sau) · giáo án/hồ sơ/học cụ
- **Sự tiến bộ của học sinh (trên số điểm kiểm tra)** ← auto được từ điểm LMS
- **Sự hài lòng của phụ huynh** (chủ quan)
- **Chỉ số học sinh** (>80% HS đạt)
- **Chấp hành nội quy** (giờ giấc, tác phong…) ← bán tự động từ điểm danh GV
- **Chất lượng dịch vụ:** tinh thần trách nhiệm

KPI Trưởng nhóm GV thêm: hiệu suất giờ dạy, tỷ lệ tái tục (≥60%), lấp đầy lớp (≥9 HS/lớp),
hài lòng PH (≥80%), nhập học sau học thử (≥25%), năng lực quản lý.

## Thang quy % → điểm (Phụ lục 01A, định lượng)
<35%=? · 35-55% · 55-70% · 70-85% · 85-95% · ≥95% (6 mức, "tùy công ty quy % ra điểm").

## Ngân sách thưởng: ≤6% tổng doanh thu thực (Excel) — docx ghi ≤8%. (P01 đang để 8% theo docx.)

## Unresolved (cần chủ dự án chốt — block P05/P06)
1. KPI model: dựng **biểu mẫu chấm 1–5 có trọng số** (đúng tài liệu) hay giữ **0–100 auto+override**
   (đã build, đơn giản hơn)?
2. Band KPI sale: 4 bậc (Excel 90/80/60) hay 5 bậc (docx) — hiện P01 theo docx.
3. Trọng số từng tiêu chí (TỶ TRỌNG) là số trong ô Excel chưa trích (cần parse worksheet) — hay
  HR sẽ tự cấu hình trong policy?
4. Ngân sách 6% (Excel) hay 8% (docx)?
