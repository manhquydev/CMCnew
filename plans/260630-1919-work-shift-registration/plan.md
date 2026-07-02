# Work Shift Registration System — Plan

**Status:** 🔄 Research phase (5 agents analyzing)
**Created:** 2026-06-30 19:19
**Lane:** High-Risk (4+ flags: Data model, Public contracts, External systems, Multi-domain)
**Branch:** develop

## Overview

Xây dựng hệ thống đăng ký công ca + chấm công check-in/checkout cho nhân viên CMCnew ERP. Hai nhóm đối tượng: Kinh doanh (chọn 1 ca/ngày) và Giáo viên (chọn linh hoạt nhiều ca/ngày).

## Risk Assessment

| Flag | Status |
|------|--------|
| Auth | ✅ Existing JWT + permission system |
| Authorization | ⚠️ New permission module needed |
| Data model | ⚠️ 5+ new Prisma models |
| Audit/security | ⚠️ IP validation for check-in |
| External systems | ⚠️ Network/IP detection |
| Public contracts | ⚠️ New tRPC routes |
| Cross-platform | ✅ Web-based only |
| Existing behavior | ⚠️ Tích hợp KPI, Payslip, EmploymentProfile |
| Multi-domain | ⚠️ HR + Attendance + Payroll |

**Classification:** HIGH-RISK (4 hard gates: Data model, Audit/security, External systems, Multi-domain)

## Phases

- [ ] Phase 1: Research & Design (current)
- [ ] Phase 2: Data Model & Migration
- [ ] Phase 3: Backend API (tRPC routes)
- [ ] Phase 4: Frontend UI (Admin panels)
- [ ] Phase 5: Integration (KPI, Payslip, Notification)
- [ ] Phase 6: Testing & Validation

## Reports

See `reports/` directory for agent analysis outputs.

## Decisions Pending

1. IP validation approach (agent #5)
2. Manager hierarchy resolution (agent #1)
3. Shift type configuration model (agent #2)
4. Leave/absence integration scope
