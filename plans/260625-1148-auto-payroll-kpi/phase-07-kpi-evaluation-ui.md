# Phase 07 — UI Phiếu đánh giá KPI (admin)

> Thiết kế chốt bởi Opus. Code giao Sonnet. UI quản lý vòng đời phiếu KPI; server đã enforce authz
> từng bước (P05/P06) — UI chỉ gọi procedure + hiển thị, không tự gác quyền (server là nguồn chân lý).

## Phạm vi
Một panel admin "Đánh giá KPI" — danh sách phiếu theo trạng thái (kanban draft/submitted/confirmed/
approved) + thao tác vòng đời + lưới tiêu chí. KHÔNG làm app teaching self-submit ở phase này (ghi
follow-up): submit là self-only, server chặn; trong panel admin nút "Nộp" chỉ chạy khi người xem
chính là chủ phiếu (server trả FORBIDDEN nếu không) — chấp nhận cho v1.

## Backend đã có (dùng nguyên, KHÔNG sửa)
`trpc.payroll`: `kpiEvalStart {userId,facilityId,periodKey,block}`, `kpiAutoPrefill {userId,facilityId,
periodKey}`, `kpiEvalSubmit {periodKey,scores}`, `kpiEvalConfirm {userId,periodKey,scores?}`,
`kpiEvalApprove {userId,periodKey}`, `kpiEvalGet {userId,periodKey}`, `kpiList {facilityId,periodKey}`,
`roster {facilityId}`, `compensation.effective {periodKey}` (lấy kpiCriteria để render nhãn tiêu chí).

## Files
- `apps/admin/src/kpi-evaluation-panel.tsx` (mới) — component `KpiEvaluationPanel`.
- `apps/admin/src/App.tsx` — thêm tab "Đánh giá KPI" value="kpi", hiển thị khi
  `me.isSuperAdmin || roles ∩ {hr,ke_toan,quan_ly,bgd,head_teacher}`. Import + render panel.

## UI (Mantine, theo mẫu compensation-panel.tsx / payroll-panel.tsx)
1. Bộ lọc: chọn `facilityId` (number input/select) + `periodKey` (TextInput YYYY-MM, default kỳ hiện tại).
2. Nút "Tạo phiếu kỳ này cho nhân sự…": chọn nhân sự từ `roster` + block (sales/training) → `kpiEvalStart`.
3. Danh sách phiếu (`kpiList`) nhóm theo `status` thành 4 cột kanban (draft/submitted/confirmed/approved).
   Mỗi thẻ: tên nhân sự (map từ roster), block, autoScore/overrideScore (nếu có), badge trạng thái.
4. Bấm thẻ → mở chi tiết (`kpiEvalGet`): lưới tiêu chí [nhãn (từ kpiCriteria) · trọng số · điểm nhập].
   - Sửa điểm từng tiêu chí (number 0-100).
   - Nút theo trạng thái: draft→[Tự điền (kpiAutoPrefill), Nộp (kpiEvalSubmit với scores)],
     submitted→[Xác nhận (kpiEvalConfirm, gửi scores nếu sửa)], confirmed→[Duyệt (kpiEvalApprove)].
   - Hiển thị điểm tổng dự kiến = Σ(trọng số×điểm)/Σtrọng số (tính client để xem trước; điểm chính thức
     do server tính lúc approve).
5. Thông báo lỗi từ server (FORBIDDEN/CONFLICT) hiển thị Alert đỏ — đây là cách UI phản ánh authz/gating.
6. Alert xanh giải thích: phiếu đi qua Nháp → Nộp (tự đánh giá) → Xác nhận (quản lý) → Duyệt (BGĐ);
   khi Duyệt điểm khóa & đổ vào phiếu lương.

## Ràng buộc kỹ thuật
- Theo mẫu `compensation-panel.tsx`: nếu type tRPC sâu gây TS2589, re-type client surface loosely
  (`trpc.payroll as unknown as {...}`) — server vẫn validate.
- Không tự ẩn nút theo quyền phức tạp; cứ gọi, server chặn → hiện lỗi. (Đơn giản, an toàn.)
- Tiền/điểm: số nguyên hoặc 2 chữ số thập phân nhất quán.

## Acceptance
- `pnpm --filter @cmc/admin typecheck` xanh.
- `pnpm --filter @cmc/admin build` xanh.
- Tab "Đánh giá KPI" xuất hiện đúng role; panel render, gọi được procedure (không cần e2e ở phase này —
  ghi chú verify thủ công/Playwright follow-up).
- Không phá typecheck/build các app khác.

## Follow-up (ngoài P07)
- Teaching app: "KPI của tôi" cho giao_vien/sale tự nộp (self-submit) trên session của chính họ.
- Playwright e2e cho luồng phiếu KPI.
