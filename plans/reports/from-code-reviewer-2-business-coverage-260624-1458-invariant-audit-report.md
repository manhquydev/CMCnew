# Reviewer #2 — Business Coverage / Spec-Code Drift / Done-Evidence Audit

> Phiên: 2026-06-24 · Reviewer: lăng kính độ phủ nghiệp vụ / drift spec↔code / done-evidence
> Không sửa code — báo cáo thuần đọc+phân tích.

---

## 1. Drift spec↔code

### 1.1 Cadence họp phụ huynh — CONFIRMED DRIFT (HIGH)

**FACT:**
- `docs/project-charter.md:63`: "Họp phụ huynh: UCREA mỗi 5 tháng; Bright I.G & Black Hole mỗi 3 tháng; auto-gen idempotent."
- `docs/specs/parent-meeting.md`: spec mô tả buổi họp "định kỳ theo lớp" nhưng không đặt ràng buộc số buổi/tháng bắt buộc ở tầng data.
- `apps/api/src/routers/parent-meeting.ts:12-38`: `create` nhận `scheduledAt` tùy ý datetime. Không có validation số buổi/tháng theo chương trình.
- `apps/api/test/parent-meeting-cadence.int.test.ts`: Test file CÓ TÊN "cadence" nhưng nội dung thực tế test `remindedAt` idempotency (dedup nhắc T-1), KHÔNG test cadence. Test có thể PASS dù tạo 10 lịch/tháng cho lớp UCREA.
- Plan `plans/20260624-business-hardening/plan.md:44` đã ghi nhận tự nhận: "Quyết định nghiệp vụ mở."

**JUDGMENT:** Đây là drift đã biết và được ghi nhận là "quyết định mở." Chưa phải bug nếu business chấp nhận không enforce. Nhưng tên file test `parent-meeting-cadence.int.test.ts` gây hiểu lầm — nó không test cadence, cần rename hoặc thêm comment tường minh để tránh người mới hiểu sai coverage.

---

### 1.2 Win-back logic tại receiptApprove — PARTIAL DRIFT (MEDIUM)

**FACT:**
- `docs/specs/payroll-v2-commission-design.md:46`: "Quay lại sau gián đoạn = KHÁCH MỚI (win-back) nếu đi qua phễu test đầu vào mới (có Opportunity + TestAppointment entrance mới)."
- `apps/api/src/routers/finance.ts:238`:
  ```ts
  const kind = opp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected > 0 ? 'renewal' : 'new';
  ```

**Phân tích:** Spec nói win-back = khách mới NẾU "đi qua phễu test đầu vào mới (có Opportunity + TestAppointment entrance mới)." Code chỉ check `opp?.stage === 'O5_ENROLLED'` — điều kiện này đúng với khách mới thông thường, nhưng không verify "có TestAppointment entrance mới." Nếu một opp đạt O5_ENROLLED qua cách nào đó không có entrance test (e.g., manual advance), nó vẫn được gán `kind = 'new'`.

Spec nói có hai điều kiện: opp đến O5 VÀ có TestAppointment entrance. Code chỉ kiểm tra điều kiện đầu.

**JUDGMENT:** Rủi ro thấp vì O5 thường đòi hỏi qua O3/O4 (entrance test) — nhưng không phải invariant được enforce ở DB/router. Stage có thể bị advance thủ công. Không có integration test kiểm chứng win-back vs renewal phân loại đúng khi không có TestAppointment.

---

### 1.3 Voucher validFrom/validTo — không recheck ở receiptCreate — MEDIUM

**FACT:**
- `docs/specs/phase-03-revenue-crm.md:69`: "Voucher: `validFrom?`/`validTo?`..."
- `apps/api/src/routers/finance.ts:164-171`: `receiptCreate` kiểm tra voucher `active` nhưng KHÔNG kiểm tra `validFrom`/`validTo`. Một voucher hết hạn vẫn được gắn vào draft receipt.
- `apps/api/src/routers/finance.ts:214-221`: `receiptApprove` có kiểm tra `valid_from`/`valid_to` trong raw SQL WHERE clause — nên CONFLICT khi approve với voucher hết hạn.

**Phân tích:** Behavior hiện tại: draft có thể tạo với voucher hết hạn → approve sẽ CONFLICT (đúng). Nhưng UX xấu: lỗi chỉ xuất hiện tại approve, không phải tại create. Không phải bug nhưng là drift giữa UX kỳ vọng (fail sớm) và code (fail muộn).

---

### 1.4 RLS Payroll tables — CLAIM không có verification script — HIGH

**FACT:**
- `plans/20260624-business-hardening/plan.md:7` claim: "RLS 37/37 bảng + principal-aware 10/10 có bằng chứng file:line."
- `packages/db/src/verify-rls.ts`: Script chỉ verify 1 bảng `facility` — không test `payslip`, `salary_rate`, `employment_profile`, `parent_meeting`, v.v.
- `apps/api/test/rls-tenancy.int.test.ts`: Chỉ test bảng `student`.
- Schema có 46 `@@map` (tức 46 bảng). Script verify-rls chỉ test 1.

**JUDGMENT:** Claim "37/37 bảng" không có backing evidence trong code — không có script nào loop qua 37 bảng và prove isolation. Claim này là **FACT sai**: verify-rls.ts chỉ test facility table. Payroll tables (salary_rate, payslip) có RLS ở Prisma/router level (requireRole HR_ROLES) nhưng DB-level RLS isolation cho từng bảng chưa được verify tự động. Đây là rủi ro nếu RLS migration có bug trên bảng cụ thể.

---

### 1.5 PIT 7 bậc — CORRECT, đủ test

**FACT:** `packages/domain-payroll/src/pit.ts` implement đúng 7 bậc lũy tiến từng phần (không nhân thẳng). Test `payroll.test.ts` phủ: 0, 5M, 8M, 20M, 100M — đủ để bắt lỗi flat-rate. Integration test `payroll-finalize.int.test.ts` cũng verify marginal rate < 25% để loại trừ flat-top-bracket bug.

**VERDICT:** PASS — không có drift, test đầy đủ.

---

### 1.6 Discount trần 35% — CORRECT, đủ test

**FACT:** `packages/domain-finance/src/pricing.ts` và unit test phủ: under-cap, at-cap, over-cap. Integration test `voucher-atomic.int.test.ts:97-108` verify stack tier 30% + voucher 20% = cap 35%.

**VERDICT:** PASS.

---

### 1.7 Finalize lương gating — CORRECT, đủ test

**FACT:** `apps/api/src/routers/payroll.ts:188-189` block recompute khi `status !== 'draft'`. Integration test `payroll-finalize.int.test.ts` verify: finalize → recompute CONFLICT, reopen → compute lại OK, finalizedById cleared.

**VERDICT:** PASS.

---

## 2. Lỗ hổng coverage — invariant rủi ro cao chưa có test

### 2.1 FinalGrade computation — KHÔNG có integration test (HIGH)

**FACT:**
- `apps/api/src/routers/assessment.ts:84-163`: `computeFinalGrade` router procedure thu thập grades/attendance/qualitative từ DB rồi gọi `@cmc/domain-grading`.
- Domain unit test `grading.test.ts` test logic thuần rất tốt (3 công thức UCREA/BI/BH, pass boundary, incomplete).
- Nhưng KHÔNG có integration test nào gọi `assessment.computeFinalGrade` qua router thật để verify: (a) grades được lọc đúng `isPublished=true`, (b) attendance aggregation đúng, (c) formula đọc từ `GradingTemplate` hoặc fallback, (d) upsert idempotent.
- Đặc biệt: `assessment.ts:102-109` filter grades theo `isPublished: true` nhưng không có test nào verify rằng unpublished grades KHÔNG tính vào FinalGrade.

**RỦI RO:** GV publish nhầm grade → FinalGrade sai; hoặc bug trong aggregation không bị bắt.

---

### 2.2 Grade → Badge auto-award — KHÔNG có integration test (HIGH)

**FACT:**
- `apps/api/src/routers/grade.ts:126-183`: `grade.publish` tự động evaluate badges và issue `StudentBadge` + notification.
- Domain unit test `badges.test.ts` test `evaluateBadges` thuần.
- KHÔNG có integration test nào verify: (a) badge được award đúng khi threshold đạt, (b) award idempotent (`skipDuplicates`), (c) notification `badge_awarded` được tạo, (d) star aggregate dùng đúng (SUM bao gồm cả âm từ redemption).

**RỦI RO:** Badge idempotency phụ thuộc `@@unique(studentId, badgeId)` + `skipDuplicates` — nếu Prisma hoặc migration thay đổi unique constraint thì double-award, không có test bắt.

---

### 2.3 Certificate auto-issue tại level-up approve — KHÔNG có assertion (MEDIUM)

**FACT:**
- `apps/api/test/level-progress-authz.int.test.ts:36-38`: afterAll cleanup `certificate.deleteMany` — chứng tỏ approve tạo Certificate.
- Nhưng test KHÔNG assert rằng Certificate đã được tạo: không có `expect(certs).toHaveLength(1)` hay tương tự.
- `apps/api/src/routers/level-progress.ts` (chưa đọc trực tiếp nhưng spec Phase 2 §2.10 nói "auto-issue Certificate" khi approve).

**RỦI RO:** Certificate auto-issue có thể im lặng fail (e.g., missing FK field) mà test vẫn xanh vì cleanup `deleteMany` không fail khi có 0 rows.

---

### 2.4 Attendance streak — KHÔNG CÓ LOGIC trong codebase (HIGH)

**FACT:**
- `docs/project-charter.md:65`: "Điểm danh streak: chuẩn timezone ICT (UTC+7)."
- Grep `streak` trong `packages/`: chỉ thấy 1 hit trong `badges.test.ts:10` — test rằng `parseCriteria({kind:'streak',...})` trả về `null` (tức kind 'streak' KHÔNG được hỗ trợ trong badge criteria).
- Không có file nào trong `packages/` hoặc `apps/api/src/` implement attendance streak logic.
- `domain-rewards/src/badges.ts` không support `streak` criteria kind.

**RỦI RO:** Charter nêu streak là feature, nhưng không có implementation hay test. Nếu spec sau yêu cầu badge theo streak thì phải build từ đầu. Hiện tại không phải bug nếu chưa build, nhưng charter claim là misleading.

---

### 2.5 Class-batch code atomicity — unit test tồn tại nhưng không có integration test (MEDIUM)

**FACT:**
- `packages/domain-academic/src/schedule.test.ts` test `formatBatchCode` (format thuần).
- `apps/api/src/services/batch-code.ts`: `nextBatchCode` dùng `pg_advisory_xact_lock` + upsert counter — đúng cách.
- KHÔNG có integration test verify concurrent `classBatch.create` → mã không trùng (tương tự `voucher-atomic` test cho receipt code).
- Receipt code (`receipt-code.ts`) dùng cùng pattern nhưng cũng không có integration test riêng cho atomicity.

**RỦI RO:** Thấp vì advisory lock pattern đã proven ở Postgres, nhưng không có "mutation test" (bỏ lock → conflict) như voucher test đã làm để prove test có răng.

---

### 2.6 commissionForSale không test integration end-to-end (MEDIUM)

**FACT:**
- `apps/api/src/routers/payroll.ts:110-165`: `commissionForSale` query đọc CompensationPolicy, SalaryRate, groupBy receipts theo kind/soldById/period.
- Domain unit `commission.test.ts` test formulas rất kỹ.
- KHÔNG có integration test verify: soldById được set đúng tại receiptApprove → commissionForSale aggregate đúng → số khớp domain-payroll calculation.
- Spec `payroll-v2-commission-design.md:53` claim "Verified live: 8.5tr@quota10tr→85%→2%→170k" — nhưng đây là manual curl, không có auto test.

---

## 3. Done-evidence giả / claim chưa chứng minh

### 3.1 "CI xanh" — FALSE CLAIM (CRITICAL)

**FACT:**
- `git remote -v`: trả về rỗng — không có remote GitHub.
- `.github/workflows/ci.yml` tồn tại với đủ step (migrate, seed, unit, integration, build).
- `plans/20260624-business-hardening/plan.md:51`: bản thân plan đã ghi nhận: "CI chưa từng chạy thật." Tuy nhiên plan overview (line 7) viết: "mọi invariant rủi ro cao... có bằng chứng file:line" — statement này đúng cho invariant tests, nhưng từ "CI" trong plan status "✅ unit+integration đã vào CI" (line 13) là misleading: test đã viết vào CI config nhưng CI workflow chưa bao giờ thực thi.
- Acceptance criteria "CI fail nếu một invariant bị phá" ở `plan.md:32` còn checkbox UNCHECKED (chưa verify).

**VERDICT:** CI config hợp lệ nhưng chưa có done-evidence thật (không có run history, không có remote). Bất kỳ claim "CI xanh" nào là chưa chứng minh.

---

### 3.2 "RLS 37/37 bảng" — FALSE CLAIM (HIGH)

**FACT:** Đã phân tích ở mục 1.4. `verify-rls.ts` chỉ test 1 bảng (`facility`). Schema có 46 bảng (46 `@@map`). Claim "37/37" xuất phát từ đâu không truy được trong codebase — không có script nào đếm/test 37 bảng.

**VERDICT:** Số "37/37" là claim không có backing code. Không rõ nguồn gốc — có thể từ một phiên agent trước không còn code.

---

### 3.3 "Verified live" cho PM2/CV3/CV4 — UNVERIFIABLE (MEDIUM)

**FACT:**
- `docs/specs/parent-meeting.md:27`: "Verified live: tick nhắc 1 lịch → 3 notification; tick lần 2 → 0 (remindedAt); PH HQ thấy trong feed + myMeetings; PH CS2 không thấy (RLS)."
- `docs/specs/payroll-v2-commission-design.md:52-53`: "Verified live: owner mặc định người tạo...", "Verified live: 8.5tr@quota10tr..."

**Phân tích:** "Verified live" là manual curl test tại thời điểm build. Không có script reproductible, không có log lưu lại, không có auto test tương ứng. Nếu code refactor, không có gì tự động phát hiện regression.

Riêng PM2: integration test `parent-meeting-cadence.int.test.ts` cover idempotency remindedAt — đây là đủ cho invariant cốt lõi. Nhưng "PH HQ thấy, PH CS2 không thấy" (RLS isolation trên parent_meeting) chưa có auto test tương ứng.

**VERDICT:** Manual "verified live" không phải done-evidence tự động. Không phải false claim nhưng không bền vững — regression có thể xảy ra không bị phát hiện.

---

### 3.4 "Phase 03 live verify — CHƯA" — đã tự nhận (LOW)

**FACT:** `plans/20260624-business-hardening/plan.md:46` đã tự nhận: "UI chatter có thật nhưng chưa chạy app thật → chưa có done-evidence live." Không phải false claim — đã trung thực ghi nhận.

---

## 4. Domain unit test — đánh giá công thức lõi

### 4.1 PIT 7 bậc — PASS ✓

`packages/domain-payroll/src/payroll.test.ts`: 5 test case (0, 5M, 8M, 20M, 100M) phủ đầy đủ biên bậc và lũy tiến từng phần. Test `assemblePayslip` cũng verify PIT không áp dụng khi gross < self_relief (10M < 11M). Integration test bổ sung kiểm marginal rate.

### 4.2 3 công thức điểm (UCREA/BI/BH) — PASS ✓

`packages/domain-grading/src/grading.test.ts`:
- `programWeights`: test 3 chương trình đúng tỷ lệ charter (100/0, 60/40, 30/70).
- `computeFinalGrade`: test UCREA (qualitative only), BRIGHT_IG (60/40 blend, math verified), BLACK_HOLE (30/70 blend), incomplete case (quant null), pass boundary (5.0 pass, 4.99 fail).
- Math trong comment được verify thủ công: 0.6×8 + 0.4×7.8 = 7.92 đúng.

### 4.3 Hoa hồng quota bậc thang (PA2) — PASS ✓

`packages/domain-payroll/src/commission.test.ts`:
- `cvtvNewCustomerRate`: 11 data point phủ đủ 6 band (0/<50%, 1%/50–79%, 2%/80–99%, 3%/100–120%, 4%/121–150%, 4.5%/>150%).
- `renewalRate`: test retentionFloor (threshold 50%), 5 role variants.
- `commissionAmount`: verify rounding.
- Custom policy test: chứng minh params-driven (không hardcode).

### 4.4 BHXH — KHÔNG có formula validation (MEDIUM)

**FACT:**
- Spec `phase-04-payroll.md:29`: "insuranceDeduction (mặc định 0 — BHXH NLĐ 10.5% nhập sau nếu cần)."
- Code: `insuranceDeduction` là input thủ công, không tự tính 10.5%.
- Không có unit test verify 10.5% calculation — nhưng đây là design intent (nhập tay v1).

**VERDICT:** Đúng spec — không phải drift. Ghi nhận để tránh nhầm "BHXH tự động" chưa có.

---

## 5. Phát hiện bổ sung

### 5.1 parent-meeting reminder: notification recipient là `studentId`, không phải `parentAccountId` — DRIFT với spec (HIGH)

**FACT:**
- `docs/specs/parent-meeting.md:20-22` (đường nhắc): `→ Student → Guardian → ParentAccount (distinct) → tạo Notification cho mỗi phụ huynh: recipientType='parent', recipientId=parentAccountId`.
- `apps/api/src/services/parent-meeting-reminder.ts:30-48`: Code thực tế lấy `enrollment.studentId` và tạo notification với `recipientType: 'student', recipientId: studentId`.

Spec nói: recipient = `parent`, recipientId = `parentAccountId`.
Code thực tế: recipient = `student`, recipientId = `studentId`.

Spec có lý do: PH login bằng `ParentAccount`, nên notification phải có `recipientType='parent'` để RLS và feed của PH lọc được.

Code hiện tại gửi notification cho `student` — PH sẽ KHÔNG thấy notification này trong feed của PH (feed PH filter theo `recipientType='parent'`), chỉ HS thấy. Đây là **bug nghiệp vụ thật**: PH không nhận được nhắc họp phụ huynh.

"Verified live: PH HQ thấy trong feed + myMeetings" trong spec có thể là claim sai hoặc verify qua `myMeetings` (lmsProcedure dùng RLS enrollment) chứ không phải qua notification feed PH.

---

### 5.2 receiptList không filter theo facilityId — MEDIUM

**FACT:**
- `apps/api/src/routers/finance.ts:122-133`: `receiptList` chỉ filter `studentId` tùy chọn, không require `facilityId` input.
- RLS tự isolate theo facility_ids của session — nên cross-facility leak không xảy ra.
- Nhưng không có facilityId param nghĩa là staff HQ có thể list TẤT CẢ receipts của HQ (không giới hạn theo lớp/kỳ) với `take: 100` hardcode. Có thể N+1 ẩn nếu sau này join thêm.

**VERDICT:** Không phải security bug (RLS bảo vệ), nhưng API contract không có facilityId filter là design gap.

---

### 5.3 payslipMarkPaid không require `finalized` → `paid` audit trail đủ — PASS

**FACT:** `payroll.ts:280-285` check `status !== 'finalized'` trước khi mark paid. Đúng spec lifecycle `draft → finalized → paid`. Test `payroll-finalize.int.test.ts` chỉ test draft→finalized→reopen, không test finalized→paid — nhưng logic đơn giản và guard rõ.

---

## 6. Tổng hợp theo mức độ

| # | Severity | Finding | File:Line |
|---|---|---|---|
| F1 | **HIGH** | parent-meeting reminder gửi notification tới `student` thay vì `parent` — PH không nhận được nhắc | `apps/api/src/services/parent-meeting-reminder.ts:32,36-47` vs `docs/specs/parent-meeting.md:20-22` |
| F2 | **HIGH** | Claim "RLS 37/37 bảng" không có backing code — verify-rls.ts chỉ test 1 bảng | `packages/db/src/verify-rls.ts:8-31` |
| F3 | **HIGH** | "CI xanh" chưa chứng minh — không có remote, workflow chưa từng chạy | `.github/workflows/ci.yml`, `git remote -v` = rỗng |
| F4 | **HIGH** | FinalGrade computation không có integration test — filter `isPublished` và aggregation chưa locked | `apps/api/src/routers/assessment.ts:84-163` |
| F5 | **HIGH** | Grade → Badge auto-award không có integration test — idempotency chưa locked | `apps/api/src/routers/grade.ts:126-183` |
| F6 | **HIGH** | Attendance streak không có implementation — charter claim misleading | `docs/project-charter.md:65`, grep streak = 0 hits logic |
| F7 | **MEDIUM** | Tên test `parent-meeting-cadence.int.test.ts` không test cadence, chỉ test remindedAt dedup | test file:1-73 |
| F8 | **MEDIUM** | Certificate auto-issue tại level-up approve không được assert trong test | `apps/api/test/level-progress-authz.int.test.ts:36-38` |
| F9 | **MEDIUM** | Win-back chỉ check `opp.stage=O5_ENROLLED`, không verify "có TestAppointment entrance mới" | `apps/api/src/routers/finance.ts:238` vs spec |
| F10 | **MEDIUM** | commissionForSale không có integration test end-to-end | `apps/api/src/routers/payroll.ts:110-165` |
| F11 | **MEDIUM** | Voucher validFrom/validTo không check tại receiptCreate — fail muộn tại approve | `apps/api/src/routers/finance.ts:164-171` |
| F12 | **LOW** | Class-batch code atomicity không có mutation integration test (pattern ok, chưa proven có răng) | `apps/api/src/services/batch-code.ts` |
| F13 | **LOW** | "Verified live" PM2/CV3/CV4 là manual, không có auto regression coverage | `docs/specs/` |

---

## 7. Các claim đã verify đúng (không phải finding)

- PIT 7 bậc: implementation và test đúng, integration test bổ sung loại trừ flat-rate bug.
- 3 công thức điểm UCREA/BI/BH: unit test đủ biên, math verified.
- Voucher atomic 35% cap: unit + integration test đủ, mutation proof có.
- Payslip finalize gating: integration test cover đủ lifecycle.
- Star redeem race + reward refund: integration test cover.
- CRM auto-hooks forward-only: integration test cover.
- Level-up authz (giao_vien không decide): integration test cover.
- RLS: facility isolation + principal isolation cho `student` table có integration test.

---

Status: DONE_WITH_CONCERNS

Summary: Phát hiện 1 bug nghiệp vụ thật (F1 — reminder gửi sai recipientType, PH không nhận được nhắc), 2 claim sai (F2 "37/37 bảng", F3 "CI xanh"), và 4 invariant HIGH-risk chưa có integration test (FinalGrade, grade→badge, win-back logic, attendance streak chưa implement). Unit test domain (PIT/điểm/hoa hồng) đúng và đủ.

Concerns (HIGH):
- F1: notification recipient bug — PH thực tế không nhận được nhắc họp (recipientType='student' thay vì 'parent').
- F2: "RLS 37/37 bảng" là claim không có backing code. Cần viết verify script thật.
- F3: CI chưa từng thực thi (thiếu remote). "CI gate" chỉ là intent, chưa thực.
- F4/F5: FinalGrade và badge auto-award là code path phức tạp không có integration test.
- F6: Attendance streak không có implementation dù charter list là feature.
