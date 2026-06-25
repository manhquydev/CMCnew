# Báo cáo điểm nghẽn: mâu thuẫn tài liệu lương CMC 2026 + cách xử lý

> Lập: 2026-06-25 14:46 ICT · Phương pháp: trích verbatim 4 file gốc (2 docx + 2 xlsx, unzip→XML,
> KHÔNG để agent đọc binary) → 3 agent đối soát song song trên text ground-truth → người tổng hợp.
> Quyết định nền: **Excel là nguồn chuẩn** (chủ dự án chốt 2026-06-25).
> Nguồn verbatim đã lưu: `scratchpad/extract/{docx-dao-tao,docx-gdtt,kpi-sales-cells,kpi-gv-cells}.txt`.

## Vì sao có báo cáo này

Một agent ở phiên trước "đọc docx" và khẳng định hoa hồng CVTV theo doanh thu tuyệt đối. Code đã
đổi theo đó. Khi rà lại, Excel (PHỤ LỤC 02) ghi rõ **theo % hoàn thành quota** — mâu thuẫn. Đào sâu:
2 tài liệu chính thức **thực sự mâu thuẫn nhau**, không phải agent bịa. Báo cáo này chốt từng điểm
nghẽn + cách giải để sau này truy được.

## Bảng điểm nghẽn & xử lý

| # | Điểm nghẽn | docx nói | Excel nói (CHUẨN) | Quyết định | Trạng thái code |
|---|---|---|---|---|---|
| C1 | **Mô hình HH CVTV khách mới** | doanh thu tuyệt đối (50/80/100/160/240tr → 1-5%) | **% hoàn thành quota** (<50/50-80/80-100/100-120/>120-150/>150% → "Theo tỷ lệ hoàn thành chỉ tiêu cá nhân") | Theo **Excel = % quota** | ✅ reverted: `cvtvNewRates [0,1,2,3,4,5%]` theo quota band |
| C2 | Tỷ lệ % HH từng bậc | CVTV 1/2/3/4/5% (rõ) | ô số merged, **illegible** | Dùng 1/2/3/4/5% (docx cung cấp, khớp cấu trúc, HR chỉnh được trong policy) | ✅ 0/1/2/3/4/5% |
| C3 | HH renewal CVTV | 50-70-90% → 1.5/2/2.2% | khớp | Giữ | ✅ `cvtvRenewalTiers` |
| C4 | Rate manager TPKD/GĐTT | TPKD 0/0.7/1.0/1.2; GĐTT 0.6/0.8/1.0 | illegible | **DEFERRED** (v1 chỉ CVTV) — không dùng, không sửa (tránh đoán mapping 5-band) | ⚠️ placeholder, flag trong code |
| C5 | Ngân sách thưởng | 8% | **6%** | Theo Excel = **6%** | ✅ `budgetPct 0.06` |
| C6 | KPI sale band B | — | Excel **tự mâu thuẫn**: sheet1 B=80%, sheet3 B=90% | Lấy **sheet1** (ma trận chấm chính) = 80% | ✅ B=80%, flag |
| C7 | KPI sale 4 hay 5 bậc | — | sheet1 có dòng "mid 0.7" mờ → có thể 5 bậc | Giữ **4 bậc** (A100/B80/C50/D0) theo chốt user | ✅, flag residual |
| C8 | KPI sale band C, D | — | sheet1 C(60-<80)=50% rõ; D suy từ O=0 | C=50%, D=0% | ✅ verified |
| C9 | KPI **giáo viên** band | A85/B70/C50/D (docx) | **Excel KHÔNG có bảng band GV** | Giữ docx (Excel im lặng, không mâu thuẫn) | ✅ giữ, flag "chỉ docx" |
| C10 | Trọng số tiêu chí KPI (TỶ TRỌNG) | — | cột tồn tại nhưng **ô số trống/0.0**; chỉ có prose: doanh số 70%, tuân thủ ~20% | Trọng số sẽ **cấu hình trong CompensationPolicy** (P05); default chờ HR | ⏳ P05 |
| C11 | Lấp đầy lớp (gate renewal manager) | 70% | 50% | DEFERRED (manager) — chưa dùng | ⚠️ flag |
| C12 | Overtime B1-B4, parttime PT3-5, PC định mức sàn 50%, bậc lương B1-B4 | rõ verbatim | (Excel không phủ) | Giữ docx — **đã verify khớp 100%** | ✅ correct |
| C13 | Quota giờ GV theo bậc (65/90/115/140) | rõ verbatim | — | Ghi nhận — cần cho công thức PC định mức (P05) | ⏳ P05 |
| C14 | PIT 7 bậc + giảm trừ 11M/4.4M | KHÔNG có trong tài liệu | KHÔNG có | Hằng số **luật TNCN** (NQ 954/2020) — không lấy từ tài liệu HR | ✅ giữ, flag statutory |

## Bảng % completion → điểm (Phụ lục 01A) — xác nhận cả 2 file
< 35%=0 · 35-<55%=1 · 55-<70%=2 · 70-<85%=3 · 85-<95%=4 · ≥95%=5 (cấp NV). Cấp QL (01B) khác:
<20/20-40/40-55/55-75/75-95 → 0-5. Dùng cho P05/P06 khi quy chỉ số định lượng ra điểm.

## Nguyên tắc xử lý áp dụng (để tái dùng khi gặp mâu thuẫn mới)
1. **Excel thắng docx** khi mâu thuẫn (chủ dự án chốt).
2. Excel illegible → dùng giá trị docx NẾU cùng cấu trúc, đánh dấu provisional + để policy chỉnh.
3. Cả 2 im lặng → giữ hằng số luật/chuẩn ngành, flag rõ nguồn ngoài tài liệu.
4. Mục DEFERRED (manager/team) → KHÔNG đoán giá trị; để placeholder + flag, chốt khi tới slice.
5. Mọi giá trị tunable nằm trong `CompensationPolicy` effective-dated → sửa không cần deploy.

## Còn mở (cần HR xác nhận, KHÔNG chặn v1 CVTV+GV)
1. Rate manager TPKD/GĐTT chính xác (C4) + gate lấp đầy 50/70% (C11).
2. KPI sale: 4 hay 5 bậc (C7); band B 80% hay 90% (C6).
3. Trọng số từng tiêu chí KPI (C10) — số trong Excel trống.
4. Top rate HH CVTV: 4.5% (PA2 cũ) hay 5% (docx) — đang để 5%.
