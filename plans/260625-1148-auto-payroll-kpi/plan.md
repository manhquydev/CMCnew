# Plan — Hệ thống tính lương + KPI tự động (auto-payroll-kpi)

> Lập: 2026-06-25 11:48 · Nhánh: develop · Lane: **high-risk** (intake #9)
> Decisions: [0010 Callio](../../docs/decisions/0010-callio-call-metrics-integration.md) ·
> [0011 Auto-KPI override](../../docs/decisions/0011-auto-kpi-with-tree-override-audit.md)

## Mục tiêu

Tự động hóa hoàn toàn cơ chế tính lương: KPI auto-compute từ dữ liệu thật (điểm HS, tái tục,
điểm danh, doanh thu, cuộc gọi Callio), cấp quản lý override được theo cây quyền, hệ thống ghi
full log minh bạch. Đóng các nợ Phase 4 ("hoa hồng/vượt giờ tự động", "thưởng quý/năm").

## Bối cảnh

- Lương lõi (PIT 7 bậc, prorate, finalize gating, payslip lifecycle) ĐÃ XONG (Phase 4).
- Hoa hồng sale từ receipt ĐÃ auto (CV4). KPI điểm + overtime GV còn nhập tay.
- 3 lãnh đạo chủ chốt KHÔNG tính lương (startup) → phạm vi auto = **giáo viên + sale**.
- Callio token đã verify live; field CDR đã khóa (`billDuration`, `direction`, `fromUser.email`).

## Phát hiện lệch vs tài liệu gốc (phải sửa)

| Mục | Code hiện tại | Tài liệu gốc |
|---|---|---|
| KPI sale band | 4 bậc, B=0.9 | **5 bậc** A/B/C/D/E; B=0.8; D(40-50)=0.6; E(<40)=0 |
| Renewal CVTV | flat 2.2% nếu ≥50% | **4 bậc**: <50%=0, 50-70%=1.5%, 70-90%=2%, ≥90%=2.2% |
| PC định mức GV | tĩnh | **= actual_hours/quota × allowance, sàn 50%** |

## Phases

| Phase | Tên | Track | Status | Depends |
|---|---|---|---|---|
| 01 | Sửa params đúng tài liệu gốc (CVTV HH tuyệt đối, renewal 4-tier, KPI sale 5-band) | A | ✅ done (PAY-COMP-PARAMS) | — |
| 02 | Salary-grade + rate change audit (Odoo-style chatter) | B | ✅ done (PAY-GRADE-AUDIT) | — |
| 03 | Callio call-metrics: client + polling + `call_metric` snapshot | C | ✅ done (PAY-CALLIO-CALLS) | — |
| 04 | KPI override + audit (`kpi_score` + record_event, cây quyền) | A | ✅ done (PAY-KPI-OVERRIDE) | 01 |
| 05 | Phiếu đánh giá KPI: model + workflow draft→submit→confirm→approved + criteria-in-policy | — | ✅ done (PAY-KPI-EVAL) | 01,04 |
| 06 | Auto-prefill ô định lượng (revenue/grades/attendance) | — | ✅ done (PAY-KPI-PREFILL) | 05,03 |
| 07 | UI phiếu KPI admin (kanban + lưới chấm + workflow) | — | ✅ done (PAY-KPI-UI) | 05,06 |

> Thiết kế phiếu KPI đã CHỐT (decision 0011 updated): 2 phiếu liên kết · workflow tự đánh giá→N+1
> →N+2 · tiêu chí+trọng số cấu hình trong CompensationPolicy · band sale 4 bậc. Engine `weightedKpi`
> đã build+test. Rubric thật: `plans/reports/researcher-260625-1337-kpi-rubric-extraction-report.md`.
> P05-07 = feature "Phiếu đánh giá KPI" — build kế tiếp (không còn block).

P01, P02, P03 độc lập → song song. P04 cần P01. P05 cần P01+P04. P06 cần P03+P04. P07 cuối.

## Acceptance Criteria

- [ ] `domain-payroll` params khớp tài liệu gốc: sale 5-band, renewal 4-tier, PC định mức theo giờ — có test.
- [ ] Đổi `SalaryRate`/`grade` ghi chatter (ai/cũ→mới/lý do) — int-test.
- [ ] `GET /call` Callio → `call_metric` snapshot theo kỳ; cuộc hợp lệ = outbound & billDuration>5 — int-test (mock HTTP).
- [ ] KPI auto-compute GV ra điểm 4 tiêu chí từ DB; sale ra quota%/calls/leads — int-test.
- [ ] Override KPI theo cây quyền: quản lý sửa nhân sự dưới quyền OK; sửa chính mình/ngoài quyền = FORBIDDEN; mỗi sửa ghi `kpi_override_log` — int-test.
- [ ] `payslipCompute` đọc KPI auto (đã override nếu có) thay vì HR gõ tay — int-test + verify live.
- [ ] E2E smoke: HR mở tab Lương, thấy breakdown KPI, sửa 1 điểm có lý do, tính payslip.

## Files (dự kiến)

- `packages/domain-payroll/src/params.ts`, `commission.ts`, `payslip.ts`, `kpi.ts` (mới)
- `packages/domain-payroll/src/*.test.ts`
- `packages/db/prisma/schema.prisma` (+`call_metric`, `kpi_override_log`, `EmploymentProfile.callioExt`) + migration
- `packages/integrations/callio/` hoặc `apps/api/src/lib/callio.ts` (client polling)
- `apps/api/src/routers/payroll.ts` (kpiCompute, kpiOverride, salaryRate audit)
- `apps/admin/src/...` (KPI breakdown + override UI)
- `apps/api/test/*.int.test.ts`

## Risks

| Risk | Mitigation |
|---|---|
| Callio rate limit chưa rõ | backoff khi 429; pageSize 100; chạy theo kỳ + snapshot |
| Map ext↔user sai → KPI calls sai | gán `callioExt` tường minh; verify với `/user` list |
| Công thức "chất lượng giảng dạy" lệch | hướng B: auto đề xuất + override có log |
| Đổi params ảnh hưởng payslip cũ | CompensationPolicy effective-dated + finalize đóng băng (đã có) |
| Cây quyền chưa có managerId | v1: role+facility scope; reporting-line chi tiết hoãn (ghi DEBT) |

## Stop conditions (high-risk)

Dừng hỏi người nếu: công thức KPI mơ hồ thêm; cần đổi schema lương ngoài dự kiến; rủi ro mất
dữ liệu payslip đã finalize; cần nới lỏng RLS lương.

## Phase files

- [Phase 01 — Sửa params](phase-01-fix-comp-params.md)
- [Phase 02 — Salary audit](phase-02-salary-grade-audit.md)
- [Phase 03 — Callio call-metrics](phase-03-callio-call-metrics.md)
- [Phase 04 — KPI override + audit](phase-04-kpi-override-audit.md)
- [Phase 05 — KPI auto GV](phase-05-kpi-auto-teacher.md)
- [Phase 06 — KPI auto sale](phase-06-kpi-auto-sales.md)
- [Phase 07 — UI + wire payslip](phase-07-ui-wire-payslip.md)
