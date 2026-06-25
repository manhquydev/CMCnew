# Phase 06 — Auto-prefill ô KPI định lượng từ dữ liệu thật

> Công thức CHỐT bởi Opus 2026-06-25, bám schema thật (đã verify field tồn tại). Code giao Sonnet.
> Nguyên tắc: chỉ auto những tiêu chí **đo được khách quan**; tiêu chí chủ quan để quản lý chấm tay.
> Không có dữ liệu → score 0 + cờ `dataAvailable=false` để quản lý biết phải chấm tay.

## Procedure mới: `payroll.kpiAutoPrefill` (requireRole hr, ke_toan; super passes)
Input `{ userId, facilityId, periodKey }`. Tác dụng: tính điểm auto cho các tiêu chí định lượng theo
block của nhân sự, **merge vào criterionScores của phiếu KPI draft** (chỉ ghi đè key auto; key chủ quan
giữ nguyên/để quản lý chấm). Chỉ chạy khi phiếu tồn tại & status=draft (nếu chưa có → NOT_FOUND, HR start trước).
Trả về `{ computed: [{key,score,dataAvailable}], context: { validCalls, approvedRevenue, quota } }`.

Block lấy từ AppUser.roles (sale → 'sales', else 'training'). Khoảng kỳ = periodRangeMs(periodKey).

## Công thức theo block (chỉ tiêu chí auto được)

### SALES (block='sales') — key auto: `doanh_so`
- `quota` = SalaryRate.monthlyQuota hiệu lực tại kỳ (như commissionForSale).
- `approvedRevenue` = Σ Receipt.netAmount WHERE soldById=user, facilityId, status∈(approved,sent,reconciled),
  approvedAt∈[kỳ]. (gộp new+renewal — đây là tổng doanh số cá nhân.)
- `attainment` = quota>0 ? approvedRevenue/quota : 0
- `doanh_so score` = `ratioToScore(attainment)` (0..100, cap 100). dataAvailable = quota>0.
- `tuan_thu`, `khac`: KHÔNG auto (chủ quan) — để quản lý chấm.
- context.validCalls = CallMetric.validCalls (user,period) nếu có (hiển thị, không tính vào điểm — seed
  criteria không có key 'calls'; nếu HR thêm key 'calls' vào policy sau thì mở rộng).

### TRAINING/GIÁO VIÊN (block='training') — key auto: `chuyen_mon`, `tuan_thu`
- **`chuyen_mon`** (chất lượng = tiến bộ HS qua điểm kiểm tra — hướng B bán tự động):
  `avg(Grade.score / Grade.maxScore) × 100` WHERE Grade.gradedById=user, facilityId, isPublished=true,
  gradedAt∈[kỳ]. Không có grade nào → score 0, dataAvailable=false.
- **`tuan_thu`** (chấp hành — proxy: hoàn thành điểm danh lớp mình dạy):
  `(# ClassSession status=confirmed, teacherId=user, sessionDate∈[kỳ], có ≥1 Attendance.markedAt) /
   (# ClassSession status=confirmed, teacherId=user, sessionDate∈[kỳ]) × 100`. Không có session → 0, flag false.
- `khac`: KHÔNG auto.

## Wiring
- KHÔNG tự gọi trong kpiEvalStart (giữ tách biệt; HR bấm "Tự điền" sau khi start). KISS.
- Sau prefill, luồng vẫn: submit → confirm → approve (P05). autoScore tính lúc approve từ criterionScores.

## Files
- `apps/api/src/routers/payroll.ts` — thêm `kpiAutoPrefill`. Tái dùng `periodRangeMs`, `periodEnd`,
  `ratioToScore` (import từ @cmc/domain-payroll), `withRls/requireRole/logEvent`.
- `apps/api/test/kpi-auto-prefill.int.test.ts` (mới).

## Tests (int)
- Sales: seed user(sale)+rate(quota 100M)+2 receipt approved (60M+20M=80M) trong kỳ → start phiếu →
  prefill → doanh_so score = 80 (80M/100M=0.8→80), dataAvailable=true.
- Teacher: seed user(giao_vien)+2 published grade (8/10, 6/10) gradedById=user trong kỳ → chuyen_mon=70.
  + 2 confirmed session teacherId=user, 1 có attendance marked → tuan_thu=50.
- Edge: không có dữ liệu → score 0 + dataAvailable=false; prefill khi status≠draft → CONFLICT.
- Audit: ghi record_event "tự điền KPI".

## Acceptance
- int-test xanh; typecheck xanh; verify-all không regression.

## Ngoài phạm vi (flag)
- Tỷ lệ tái tục trung tâm (renewal gate) — định nghĩa "tái nhập học" phức tạp, giữ input tay ở
  commissionForSale.centreRetentionRatio. Ghi DEBT.
- "on-time" giờ vào lớp của GV: hệ thống chưa track giờ check-in GV → tuan_thu dùng proxy điểm-danh.
