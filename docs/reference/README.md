# Tài liệu nguồn — Cơ cấu thu nhập CMC 2026 (scan nguyên văn)

Thư mục này chứa bản **transcribe đầy đủ, không tóm tắt** của bộ tài liệu gốc "Cơ cấu thu nhập CMC 2026" do chủ dự án cung cấp (nguồn: `C:\Users\manhquy\Downloads\...\Cơ cấu thu nhập CMC 2026`). Dùng làm tham chiếu chuẩn khi phát triển module payroll. Khi code công thức lương/thưởng, đối chiếu file ở đây thay vì trí nhớ.

## Danh mục

| File | Nội dung | Ngày/Số hiệu |
|---|---|---|
| [co-cau-thu-nhap-khoi-dao-tao-2026.md](co-cau-thu-nhap-khoi-dao-tao-2026.md) | Khối Đào tạo: GV 4 bậc, TNGV, GĐĐT · vượt giờ · KPI · parttime PT3/4/5 | QĐ26/CMC/NS/2026 — 11/05/2026 |
| [co-cau-thu-nhap-khoi-kinh-doanh-2026-pa1.md](co-cau-thu-nhap-khoi-kinh-doanh-2026-pa1.md) | Khối Kinh doanh **PA1**: bậc lương, KPI, hoa hồng (theo doanh thu tuyệt đối), thưởng quý/năm | QĐ25/CMC/NS/01 — 01/05/2026 |
| [mau-kpi-giao-vien-tngv-2026.md](mau-kpi-giao-vien-tngv-2026.md) | Biểu mẫu chấm KPI GV & TNGV (chỉ tiêu + tỷ trọng + thang điểm) | 2026 |
| [mau-kpi-kinh-doanh-2026-pa2.md](mau-kpi-kinh-doanh-2026-pa2.md) | Biểu mẫu KPI Kinh doanh + **PA2** khung thu nhập & hoa hồng (bảng tính thử quý/năm) | 17/06/2026 |

## ⚠️ XUNG ĐỘT QUAN TRỌNG: hai phương án thu nhập khối Kinh doanh (PA1 vs PA2)

Bộ tài liệu chứa **HAI phiên bản chính sách khối Kinh doanh khác nhau**. Cần chủ dự án chốt phương án nào là chính thức TRƯỚC khi nối công thức hoa hồng vào payslip. Khác biệt cốt lõi:

| Tiêu chí | **PA1** (QĐ chính thức, docx 01/05) | **PA2** (xlsx "Mẫu/Bảng tính thử", 17/06) |
|---|---|---|
| Lương cơ bản CVTV | 5,700,000 | 4,600,000 |
| Hoa hồng khách mới (CVTV) | Theo **doanh thu tuyệt đối/tháng**: <50tr=0 · 50–80=1% · >80–100=2% · 100–160=3% · >160–240=4% · >240=5% | Theo **% hoàn thành quota**: <50%=0 · 50–80%=1% · 80–100%=2% · 100–120%=3% · >120–150%=4% · >150%=4.5% |
| KPI band Kinh doanh | A90–100=100% · B70–<90=80% · C50–<70=70% · D40–<50=60% · E<40=0% | A90–100=100% · B70–<90=90% · C<70=30% (bảng PA2 ghi chưa rõ ràng) |
| Ngân sách thưởng | ≤ 8% doanh thu thực | ≤ 6% doanh thu thực |
| Hoa hồng tái tục CVTV | 0/1.5/2/2.2% theo tỷ lệ tái tục | 2.2% (≥50%), đối chiếu 3.2% |

**Trạng thái code hiện tại:** module `packages/domain-payroll/src/commission.ts` (commit `3544ece`) đã implement theo **PA1** (doanh thu tuyệt đối + KPI band A90/B80/C70/D60/E0) — vì PA1 là Quyết định đã ký, PA2 là bảng tính thử. **Nếu chủ dự án chọn PA2, cần sửa lại commission.ts + band KPI.** Chưa nối vào payslip compute nên đổi vẫn còn rẻ.

## Ghi chú khác đáng lưu ý khi build
- **Khối Đào tạo — phụ cấp định mức** prorate theo % giờ dạy thực tế, **sàn tối thiểu 50%**; vượt định mức cộng thêm giờ vượt × đơn giá bậc (Phụ lục III: B1 100k…B4 150k).
- **Parttime** PT3/4/5 = 3/4/5tr trọn gói (không prorate ngày công); phát sinh ngoài gói 120k/giờ, chủ nhiệm 20k/HS.
- **Telesales/CTV** (PA2): đơn giá 15k/giờ + thưởng 20k/khách check-in (≥10 khách/tháng mới được thưởng).
- **Chi trả thưởng KD**: 80% kỳ hiện tại + 20% đầu quý sau; thưởng năm trả vào kỳ lương tháng 3 năm sau.
- **KPI khối Đào tạo** band khác Kinh doanh (A từ 85), đã xử lý block-aware trong `kpiGradeFromScore`.
