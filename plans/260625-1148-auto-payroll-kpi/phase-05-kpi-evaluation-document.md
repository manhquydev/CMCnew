# Phase 05 — Phiếu đánh giá KPI (workflow + criteria-in-policy)

> Thiết kế CHỐT bởi Opus 2026-06-25. Code giao Sonnet. Decision 0011 (mô hình phiếu), 0012 (trọng số).
> Nền có sẵn: `weightedKpi`/`ratioToScore` (domain-payroll), bảng `KpiScore` (P04), `canOverrideKpi`
> (apps/api/src/lib/kpi-authz.ts), CompensationPolicy + UI JSON editor (compensation-panel.tsx).

## Mục tiêu
Biến KPI thành **phiếu đánh giá kiểu Odoo** per (nhân sự, kỳ): lưới tiêu chí có trọng số, workflow
`draft → submitted → confirmed → approved` (tự đánh giá → N+1 → N+2), điểm cuối = weightedKpi(criterion
scores), khi approved đổ sang payslip (đã wire ở P04: finalScore = override ?? auto).

## A. Tiêu chí + trọng số vào CompensationPolicy (editable)
Thêm `kpiCriteria` vào `compensationParamsSchema` + `DEFAULT_PARAMS` (`packages/domain-payroll/src/params.ts`):
```
kpiCriteria: { training: Criterion[], sales: Criterion[] }
Criterion = { key: string(min1), label: string(min1), weight: number 0..1 }
```
Ràng buộc: weights mỗi block sum = 1 (±1e-6) — validate trong Zod bằng `.refine`.
Seed (decision 0012, provisional — comment rõ "HR chỉnh"):
- sales: `[{key:'doanh_so',label:'Doanh số',weight:0.7},{key:'tuan_thu',label:'Tuân thủ',weight:0.2},{key:'khac',label:'Khác',weight:0.1}]`
- training: `[{key:'chuyen_mon',label:'Chuyên môn',weight:0.6},{key:'tuan_thu',label:'Tuân thủ',weight:0.2},{key:'khac',label:'Khác',weight:0.2}]`
Export type `KpiCriterionConfig`. Test: DEFAULT validates; weights sum=1; bad sum throws.

## B. Schema — mở rộng KpiScore thành phiếu (migration mới)
Thêm cột vào model `KpiScore` (`packages/db/prisma/schema.prisma`) + migration `phase5_kpi_evaluation`:
- `status` enum `KpiStatus { draft submitted confirmed approved }` default `draft`
- `criterionScores Json?` — `[{key, score(0..100)}]` (điểm từng tiêu chí, bản đang làm việc)
- `submittedById/confirmedById/approvedById String? @db.Uuid`
- `submittedAt/confirmedAt/approvedAt DateTime?`
RLS giữ nguyên policy `kpi_score_isolation` (không cần đổi — cùng bảng). Chạy migrate deploy + generate.

## C. Procedures (apps/api/src/routers/payroll.ts) — workflow + authz + audit
Dùng `effectiveParamsAt` lấy `kpiCriteria[block]`. Mọi mutation ghi `logEvent(entityType:'kpi_score')`.

1. `kpiEvalStart` — `requireRole(hr, ke_toan)` (super passes). Input {userId,facilityId,periodKey,block}.
   Upsert KpiScore status=draft, criterionScores = mỗi tiêu chí score 0, autoScore=0. Không đụng nếu đã submitted+.
2. `kpiEvalSubmit` — `protectedProcedure`. Input {periodKey, scores:[{key,score}]}. Actor = chính chủ
   (userId = ctx.session.userId). Chỉ khi status=draft. Lưu criterionScores, status=submitted, submittedAt/By.
3. `kpiEvalConfirm` — `requireRole(quan_ly, head_teacher, bgd)`. Input {userId,periodKey,scores?,...}.
   Authz `canOverrideKpi(actor,target,targetRoles)` = true. Chỉ khi status=submitted. Cho sửa scores,
   status=confirmed, confirmedAt/By. Log cũ→mới nếu sửa.
4. `kpiEvalApprove` — `requireRole(bgd)` (super passes; bgd/super = cấp N+2 cao nhất). Input {userId,periodKey}.
   Chỉ khi status=confirmed. Actor ≠ confirmedById (tách trách nhiệm) → nếu trùng = FORBIDDEN.
   Tính `autoScore = weightedKpi(criterionScores mapped to {criterion,weight,score})` dùng weight từ policy.
   status=approved, approvedAt/By. (finalScore=override??auto đã đọc ở payslipCompute.)
5. `kpiEvalGet` — `requireRole(hr,ke_toan,quan_ly,bgd,head_teacher)`. {userId,periodKey} → phiếu + criteria config.

Giữ `kpiSetAuto`/`kpiOverride`/`kpiList` cũ (P04) — không xóa; `kpiOverride` vẫn cho cấp trên chỉnh điểm tổng có lý do.

## D. Tests (apps/api/test/kpi-evaluation-workflow.int.test.ts)
- Happy path: start(draft)→submit(self)→confirm(quan_ly)→approve(bgd); cuối status=approved,
  autoScore = weightedKpi đúng (vd sales scores doanh_so=80,tuan_thu=70,khac=60 → 0.7*80+0.2*70+0.1*60=76).
- Authz: người khác submit hộ = FORBIDDEN; giao_vien confirm = FORBIDDEN; quan_ly approve = FORBIDDEN (cần bgd);
  approver == confirmer = FORBIDDEN.
- Gating: approve khi chưa confirmed = CONFLICT/BAD_REQUEST; submit khi đã submitted = CONFLICT.
- Audit: có record_event cho mỗi bước.

## Acceptance
- `pnpm --filter @cmc/domain-payroll test` xanh (kpiCriteria).
- `pnpm --filter @cmc/api exec vitest run --config vitest.integration.config.ts test/kpi-evaluation-workflow.int.test.ts` xanh.
- `pnpm --filter @cmc/api typecheck` xanh. Không phá test cũ (verify-all).

## Ngoài phạm vi P05 (để P06/P07)
- Auto-prefill ô định lượng (calls/tái tục/điểm HS) → P06.
- UI phiếu (kanban + lưới chấm) → P07. (Tham số kpiCriteria đã editable qua JSON policy UI sẵn có.)
