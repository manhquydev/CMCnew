# Phase 07 — Grade Period (term) + Commission retention config & tree-override

**Risk:** HIGH (grades, payroll money, audit) | **Depends:** 02, 03 | **Source:** user product decisions 2026-06-26

## Decisions (user)

- **H2 grade scope** = theo **kỳ có ngày bắt đầu–kết thúc** (term with start/end). Final grade aggregates only grades/attendance within the term's date range.
- **Commission cap** = giữ nguyên (trả đủ + cảnh báo overBudget). KHÔNG enforce cap. ✓ no code change.
- **Retention default** = không hardcode 100%. Theo ERP best practice (accrue thận trọng + reconcile/true-up, tránh overpay): đưa thành tham số policy + cho quản-lý-cây override commission với audit. Auto-tính, con người (quản lý trực tiếp trở lên — `canOverrideKpi` tree) là quyết định cuối.

## 07A — Academic Term/Period (H2)

### Schema (packages/db/prisma)
- New model `AcademicTerm`: id, facilityId, name, periodKey (unique per facility), startDate (Date), endDate (Date), program? optional, createdAt. `@@unique([facilityId, periodKey])`, `@@index([facilityId])`.
- Migration (manual SQL + migrate deploy pattern, dev reset OK).

### Backend (apps/api/src/routers/assessment.ts + a term router)
- New `term` router (or under assessment): `termCreate`, `termList`, `termUpdate` (requireRole quan_ly/head_teacher).
- `computeFinalGrade` (assessment.ts:94+): resolve the term by (facilityId, periodKey); if found, filter `grade.findMany` by `gradedAt` within [startDate,endDate] and `attendance` by joined `classSession.sessionDate` within range. If no term row for the periodKey → fall back to all-time (backward-compat) + return a `periodResolved:false` flag.
- Update int-test `assessment-final-grade-publish` + add a term-scoped case (grades outside term excluded).

### Frontend (admin)
- Terms management panel (create/list term with date range) under Quản trị/Khóa học area.

## 07B — Commission retention config + tree-override

### Policy param (packages/domain-payroll/src/params.ts)
- Add `commission.renewalRetentionDefault` (0..2, default conservative e.g. 0.8 — document rationale: avoid overpay before CRM retention exists; HR/BGD can tune). `effectiveParamsAt` already loads policy.
- payslipCompute commission auto-feed: use `params.commission.renewalRetentionDefault` instead of hardcoded `1`.

### Tree-override of payslip commission (apps/api/src/routers/payroll.ts)
- New `payslipOverrideVariablePay({ userId, periodKey, amount, reason })`: guarded by `canOverrideKpi(actor, targetUserId, targetRoles)` (tree-authority, no self-override). Sets payslip.variablePay = amount + variableNote, audit old→new + reason. Only on draft payslip (not finalized/paid).
- Admin payroll-panel: surface override action (reason required) for authorized tree-managers.
- Int-test: tree-manager overrides commission with audit; self/non-tree → FORBIDDEN; finalized slip → CONFLICT.

## Validation
- `pnpm typecheck` 13/13; new int-tests pass; full api suite stays green.
- Live: term filter changes final grade; retention default from policy; tree-manager commission override audited.

## Risks
- Term migration: dev reset OK (user: data chỉ lo ở prod). Backward-compat fallback when no term row.
- Override must reuse canOverrideKpi (already tested) — consistent tree rule.
