# 0012 Safe-default cho tham số lương mơ hồ + tất cả sửa được qua UI

Date: 2026-06-25

## Status

Accepted

## Context

Sau đối soát 4 file tài liệu gốc (báo cáo điểm nghẽn
`plans/reports/from-3agent-recon-260625-1446-payroll-doc-conflicts-bottleneck-report.md`), còn 4
tham số **mơ hồ/mâu thuẫn** không thể chốt chắc chắn từ tài liệu. Cần default an toàn để chạy v1
(CVTV + giáo viên), KHÔNG chặn, và sửa được sau. Nguyên tắc: (a) không trả vượt so với nguồn rõ
nhất, (b) bám giá trị legible + có thẩm quyền nhất, (c) bảo thủ khi chưa chắc, (d) mọi giá trị sửa
được forward-only nên default sai = rủi ro thấp.

## Decision

| # | Tham số | Safe default chốt | Lý do | HR cần xác nhận sau |
|---|---|---|---|---|
| 1 | Rate hoa hồng manager (TPKD/GĐTT) | **DEFERRED** — giữ placeholder, KHÔNG dùng | v1 không trả lương manager → rủi ro 0. Excel illegible, mapping docx 5-band chưa rõ → seed = bake nhầm hợp đồng | OCR ô Excel manager + gate lấp đầy 50/70% trước khi mở slice manager |
| 2 | KPI sale: số bậc + band B | **4 bậc, B=80%** (A≥90=100·B80-<90=80·C60-<80=50·D<60=0) | sheet1 = ma trận chấm chính (legible nhất) ghi B=80%, 4 bậc sạch; B=80% là ngưỡng chặt hơn (không lợi NV) | OCR dòng "0.7" giữa (4 vs 5 bậc); vì sao sheet3 ghi B=90% |
| 3 | Trọng số tiêu chí KPI (TỶ TRỌNG) | **Sale: doanh số 70 / tuân thủ 20 / khác 10. GV: chuyên môn 60 / tuân thủ 20 / khác 20 (provisional)** | Nguồn legible duy nhất = prose sale (70/~20); phần dư 10 không dồn vào tiêu chí sinh thưởng. GV không có số → chia bảo thủ | Cấp số trọng số GV thật + chốt 10% dư của sale. **Seed khi build P05** |
| 4 | Top rate HH CVTV | **5%** (giữ) | docx là giá trị legible duy nhất, ghi rõ 5%; 4.5% là PA2 cũ đã supersede. (Lệch *cao hơn* nhưng bounded: chỉ bậc đỉnh, forward-only) | OCR ô top-band Excel; nếu 4.5% thì hạ (kỳ đã chốt giữ nguyên) |

**Tất cả tham số tunable sửa được qua UI sẵn có:** `apps/admin/src/compensation-panel.tsx` —
super_admin tạo phiên bản `CompensationPolicy` effective-dated (JSON editor, server validate Zod);
áp dụng kỳ sau, payslip đã finalize giữ nguyên. Trọng số KPI (#3) sẽ thêm vào params schema khi
build P05 (Phiếu đánh giá KPI), kế thừa cùng cơ chế editable.

## Alternatives Considered

1. Adopt docx manager rates ngay — loại: rủi ro bake nhầm, không có upside ở v1.
2. KPI sale 5 bậc / B=90% (sheet3) — loại: sheet1 là ma trận chính + B=80% chặt hơn.
3. Hạ top rate về 4.5% — loại: 5% là giá trị có thẩm quyền legible; sửa forward nếu HR xác nhận khác.

## Consequences

Positive:
- v1 chạy được với default an toàn, mọi giá trị có vết quyết định + lý do để truy.
- Sửa qua UI forward-only → đính chính rẻ, không đụng lương đã chốt.

Tradeoffs:
- Top rate 5% lệch cao hơn 4.5% (bounded, bậc đỉnh).
- Trọng số GV là placeholder — PHẢI để HR set trước khi trả thưởng KPI giáo viên thật (đánh dấu rõ ở P05).
