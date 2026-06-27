# Production Readiness & System Completion

**Created:** 2026-06-26 | **Branch:** develop | **Source:** 10-agent review report `plans/reports/10agent-code-review-260626-1413-erp-lms-comprehensive-state-report.md`

## Goal

Đưa ERP+LMS từ 🔴 NOT PRODUCTION READY → green: vá 10 critical + 62 high, hoàn thiện luồng nghiệp vụ và UI vận hành đã chốt. LMS design system riêng để sau (user xử lý).

## Resolved Decisions (gate trước khi code)

| ID | Quyết định |
|----|-----------|
| Q1 | Rate-limit = in-process tRPC limiter (IP+email 5/15ph, IP 20/15ph). KHÔNG Redis, KHÔNG nginx-primary |
| Q2 | KPI = Callio auto-compute + manual override (role-gated) + audit log minh bạch (Odoo-style). Người sửa là quyết định cuối |
| Q3 | Teaching: schedule/attendance/meetings = cross-class; enrollment/classlog = class-scoped shortcut; sessions = remove. 1 endpoint mới `schedule.mySessions` |
| Q4 | LMS student = thêm tab Khóa học + `enrollment.mine` |
| Q5 | StarTransaction = partial unique index `WHERE reference IS NOT NULL` + tRPC enforce cho `manual` |

## Phases

| # | Phase | Status | Risk | Depends |
|---|-------|--------|------|---------|
| 01 | Critical security & stability | ✅ DONE (verified + review fixes) | HIGH | — |
| 02 | Data integrity: logic bugs ✅ + schema ✅ (RLS deferred) | HIGH | — |
| 03 | KPI system: Callio + manual override + audit | ✅ DONE (27 tests, committed 2fe695c) | HIGH | 01 |
| 04 | Teaching operational UI (6 nav items) | ✅ DONE (commit 998d840, schedule.mySessions 4 int-test) | NORMAL | 02 |
| 05 | LMS student course tab + reward fixes | ✅ DONE (commit 0400383, 5 int-test) | NORMAL | 02 |
| 06 | Backend↔UI feature completion | ✅ DONE (commit 93072bc; crm contacts còn thiếu — minor) | NORMAL | 02 |

## Phase 07 progress (2026-06-26)

- ✅ **07A term-scoped grades**: AcademicTerm model + migration `20260626130000` (RLS) + term CRUD; `computeFinalGrade` lọc theo [startDate,endDate], fallback all-time. Commit done. Full suite 156/156 + domain 56/56 green.
- ✅ **Retention config**: `commission.renewalRetentionDefault` (default 0.9, `.default()` backward-compat); payslip auto-feed dùng param thay hardcode 1.
- ✅ **Commission cap**: giữ nguyên (user chốt) — no change.
- ✅ **07B commission tree-override**: `payslipOverrideVariablePay` (shared `assembleSlipData`, canOverrideKpi tree-gate, draft-only, recompute, audit) + admin terms panel + override button + 6 int-tests. Full suite 162/162 green. Commit done.

**Phase 07 DONE.** Còn lại cho vận hành: RLS hardening, Docker prod rebuild+smoke, E2E, crm contactList UI (minor).

## Milestone (2026-06-26): full api suite GREEN 156/156 (đầu phiên 34 fail)

7 commit phiên này: teaching cross-class UI, LMS student, admin wiring, payroll fixes (bulkPay shape + grade-audit), vitest setupFiles, academic guards (H3/H8). Pre-existing 7 fail → 0. Background Sonnet agents nhiều lần chết mid-report (connection) → orchestrator tiếp quản integration glue, recover đầy đủ.

**Còn lại:**
- H2 (assessment final-grade period filter): **escalate spec** — periodKey là label tùy ý (test dùng `uniq('MONTH')`), không map sang date range; hành vi all-time hiện tại là test-backed. Cần product quyết định ngữ nghĩa "period".
- Phase 06 minor: crm contactList UI chưa wire (procedure đã có).
- Open commission questions (Phase 03): cap-enforcement, retention default, kpiSetAuto SoD, override-on-approved.

## Pending api fixes (áp sau khi Phase 04 nhả apps/api — fix 2/7 pre-existing genuine fails)

1. **payslipBulkPay** (payroll.ts:441): input `z.array(...)` → `z.object({ ids: z.array(z.string().uuid()).min(1).max(200) })`; body `input`→`input.ids` (3 chỗ). RLS đã xử cross-facility. Test `payroll-bulk-pay-byid` (4) sẽ xanh.
2. **profileUpsert grade audit** (payroll.ts:36): thêm input `reason?`; fetch existing; nếu `existing.grade && input.grade && khác nhau` + thiếu reason → BAD_REQUEST; log `Đổi bậc lương {old}→{new}: {reason}` khi đổi, else generic. Test `salary-grade-change-audit` (2) sẽ xanh. Không regression (test khác create mới/không đổi grade).

Còn lại pre-existing: crm-hooks lead-token (1) — CRM_LEAD_TOKEN env trong full-suite.

## Progress Log

**Phase 01 ✅ (2026-06-26)** — typecheck 13/13, auth-login 11/11, no regression (stash baseline proven).
- C1 rate-limit (in-mem, chỉ đếm fail), C4 Docker non-root, C6 audit.timeline IDOR whitelist, C7 LMS SSE re-validate, C8 auth tests, C9/H14 cookie secure + CORS prod guard, H19-H21 nav role gates, badge icon fix.
- Code-review fixes: HIGH (XFF spoof → x-real-ip), MEDIUM (shared-NAT → chỉ đếm fail).

**Phase 02 ✅ logic bugs + schema** — H1 enrollment dup guard, H4/H5 CRM WON guards, H6 payroll workdays, H7 schedule time. Schema migration `20260626120000_data_integrity_constraints` applied: C5 StarTxn partial unique, H9 course_price unique, H10 salary_rate unique, H11 opportunity Restrict, H12 exercise Restrict, H13 parent_account CHECK. migrate reset+seed sạch; client regenerated; failed set 34→32 (không fail mới).
- Còn (logic): H2 assessment period filter, H3 submission guard, H8 class-batch reopen.
- Deferred: RLS hardening (record_event null-facility super_admin-only, record_follower RLS) — cần đổi withRls thêm GUC app.user_id.

**Findings về test suite (tình trạng thật):**
1. **KPI router CHƯA tồn tại** (~24 test fail): kpiEvalStart/kpiAutoPrefill/... gọi trên `trpc.payroll` không có; bảng KpiScore/KpiEvaluation ĐÃ có (migration phase4/5). PAY-KPI-* stories "PASS" là stale → Phase 03 wire router.
2. **Integration test KHÔNG hermetic** (~8 fail: badge/payroll-bulk/salary-grade/commission-autofeed): pass khi chạy LẺ, fail trong full suite do state tích lũy giữa file (share 1 DB, không rollback/cleanup per-file). Test-infra debt, không phải bug sản phẩm.
3. crm-hooks lead-ingest: 1 fail do CRM_LEAD_TOKEN env trong full-suite context.

**Phase 03 ✅ (commit 2fe695c)** — KPI workflow start→submit→confirm→approve (SoD), kpiAutoPrefill từ data thật, kpiOverride tree-authority+audit, kpiList/Get/SetAuto, syncCallMetrics, payslipCompute đọc override??auto. 27 KPI test xanh; full-suite 32→7 fail (140/147 pass). Code-reviewed (hard-gate); fix MED-1 (chặn 500 từ employee submit) + LOW-1 (div-zero). Test-isolation fixed (vitest serial).
- Commission auto-feed (test-mandated, mirror commissionPreview design) giữ nguyên.
- **Open product questions (review, behavior khớp design hiện có → chưa đổi):** (a) enforce budget cap tại pay-time hay chỉ surface? (b) retention default trước khi CRM feed? (c) kpiSetAuto có nên qua SoD? (d) cho phép kpiOverride trên sheet đã approved?

**Remaining 7 pre-existing fails:** payroll-bulk-pay-byid (4, input-shape mismatch), salary-grade-change-audit (2, grade-audit chưa impl), crm-hooks lead-token (1).

## Acceptance (toàn chương trình)

- 10/10 CRITICAL fixed + verified (test hoặc live check)
- High-priority data-integrity constraints applied via migration, không phá dữ liệu hiện có
- `pnpm typecheck` toàn monorepo green; integration tests cho mỗi hành vi mới
- Không regression: mỗi touchpoint + caller được review qua code-reviewer
- Mỗi phase có harness story/trace ghi nhận

## Notes

- Migration chưa apply được do cần DB chạy (xem memory `prod-ready-redesign-260625`). Phase 02/03/05 cần DB live để verify.
- CI/CD Jenkins chưa dựng → verify local (memory `cmcnew-cicd-jenkins-decision`).
- Branch: làm trên `develop`, PR vào `main` (AGENTS.md).
