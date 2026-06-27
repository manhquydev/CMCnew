# CMCnew ERP+LMS — Comprehensive 10-Agent Code Review Report

**Date:** 2026-06-26 | **Branch:** develop | **Method:** 10-agent parallel scan + adversarial verify (21 agents total)

---

## Tóm tắt nhanh

| Metric | Value |
|--------|-------|
| Total findings | **200** |
| CRITICAL (confirmed) | **10** |
| HIGH | **62** |
| MEDIUM | **87** |
| LOW | **41** |
| Cần quyết định từ user | **5** |
| **Verdict** | **🔴 NOT PRODUCTION READY** |

---

## 1. Tình trạng tổng quan (Overall Health)

| Domain | Status | Summary |
|--------|--------|---------|
| API Business Logic | 🔴 RED | 2 critical, 5 high — no rate-limit, KPI dead code, enrollment/assessment bugs |
| Security & Auth | 🔴 RED | 1 critical, 2 high — brute-force trống, IDOR audit log, SSE không re-validate |
| Docker & Infrastructure | 🔴 RED | 1 critical (root container), no TLS, no healthcheck |
| API Contract / tRPC | 🔴 RED | 1 critical (7 ghost procedures), 8+ backend routes không có UI |
| Test Coverage | 🔴 RED | 2 critical (auth 0 tests, attendance RLS không proven), 10 high |
| Database Schema | 🔴 RED | 1 critical (nullable unique phá idempotency), 7 high cascade/constraint |
| Admin UI | 🟡 YELLOW | 0 critical, 7 high — thiếu student mgmt, broken KPI panel, role leaks |
| Teaching App UI | 🟡 YELLOW | 1 critical (6 nav blank), 5 high — role guards thiếu |
| LMS App UI | 🟡 YELLOW | 1 critical (không có course view), 4 high |
| Package Quality | 🟡 YELLOW | 0 critical, 2 high — badge icon bug, env validation thiếu |

---

## 2. CRITICAL Issues — Phải fix trước khi go-live

### C1. No Rate Limiting on Login (Confirmed)
- **Files:** `apps/api/src/routers/auth.ts:20-35`, `apps/api/src/routers/lms-auth.ts:31-47`, `docker/nginx.conf`
- **Risk:** Brute-force không giới hạn trên tất cả 3 login endpoints
- **Fix tối thiểu:** Thêm vào `docker/nginx.conf`:
  ```nginx
  limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
  # trong location /api/trpc/auth:
  limit_req zone=auth burst=3 nodelay;
  ```
- **Fix proper:** Redis-backed counter trong `apps/api/src/index.ts` trước khi mount tRPC

### C2. KPI Panel — 7 Ghost tRPC Procedures (Confirmed)
- **File:** `apps/admin/src/kpi-evaluation-panel.tsx:50` — type cast `(trpc.payroll as unknown as {...})` bypass TypeScript
- **Missing in router:** `kpiList`, `kpiEvalStart`, `kpiAutoPrefill`, `kpiEvalSubmit`, `kpiEvalConfirm`, `kpiEvalApprove`, `kpiEvalGet` — không tồn tại trong `payroll.ts`
- **Fix ngay:** Thêm feature flag hoặc remove panel khỏi build — panel này crash runtime
- **Fix proper:** Implement 7 procedures + `KpiEval` migration, hoặc defer sang sprint sau

### C3. Teaching App — 6 Blank Nav Targets (Confirmed)
- **File:** `apps/teaching/src/App.tsx` — Workbench switch thiếu 6 case
- **Missing keys:** `schedule`, `sessions`, `attendance`, `enrollment`, `meetings`, `classlog`
- **Fix options:** (a) Add panel components + wire, (b) Remove nav items. Cần product decision → xem Q3

### C4. API Container Runs as Root (Confirmed)
- **File:** `apps/api/Dockerfile` — không có `USER` directive
- **Fix:**
  ```dockerfile
  RUN addgroup -S cmc && adduser -S cmc -G cmc \
      && chown -R cmc:cmc /app
  USER cmc
  ```

### C5. StarTransaction Nullable Unique — Idempotency Broken (Confirmed)
- **File:** `packages/db/prisma/schema.prisma` — `reference String?` + `@@unique([type, reference])` không ngăn duplicate NULL rows trong PostgreSQL
- **Fix (safe):**
  ```sql
  CREATE UNIQUE INDEX star_txn_type_ref_notnull ON star_transaction(type, reference)
  WHERE reference IS NOT NULL;
  DROP INDEX IF EXISTS star_transaction_type_reference_key;
  ```

### C6. IDOR via Audit Timeline — Any Staff Reads Role History of Any User (Confirmed)
- **File:** `apps/api/src/routers/audit.ts:22-25`
- **Issue:** `audit.timeline` không có entity visibility check. `facility_id IS NULL` events (user.create, user.setRoles) readable bởi mọi staff
- **Fix:**
  ```typescript
  const resolve = NOTE_TARGETS[input.entityType];
  if (!resolve) throw new TRPCError({ code: 'FORBIDDEN' });
  const entity = await resolve(tx, input.entityId);
  if (!entity) throw new TRPCError({ code: 'NOT_FOUND' });
  ```

### C7. LMS SSE — Session Not Re-validated (Confirmed)
- **File:** `apps/api/src/index.ts:165-186`
- **Issue:** `/sse/notifications` auth một lần tại connect, không re-validate trong heartbeat. `/sse/staff` (lines 213-223) đã đúng
- **Fix:** Thêm trong `while(!stream.aborted)` loop:
  ```typescript
  const refreshed = token ? await resolveLmsSession(token) : null;
  if (!refreshed || refreshed.accountId !== lms.accountId) {
    unsubscribe(); break;
  }
  ```

### C8. Auth Router — Zero Integration Tests (Confirmed)
- **File:** `apps/api/src/routers/auth.ts` — 3 procedures, 0 test files
- **Paths untested:** tokenVersion invalidation, `isActive` check, concurrent sessions
- **Fix:** Tạo `apps/api/test/auth-login.int.test.ts` covering: wrong password → UNAUTHORIZED, inactive → FORBIDDEN, logout invalidates, tokenVersion bump blocks old session

### C9. No TLS on Nginx (Confirmed)
- **File:** `docker/nginx.conf` — chỉ listen port 80
- **Fix:** TLS termination (Let's Encrypt sidecar hoặc upstream LB). Tối thiểu: `secure: true` unconditionally trên cookies (không phụ thuộc `NODE_ENV`)

### C10. Student App — No Course/Enrollment View (Confirmed)
- **File:** `apps/lms/src/student-view.tsx`, `apps/lms/src/student-shell.tsx`
- **Issue:** Students không thể xem khóa học/lớp đang học. Backend có `course` và `enrollment` routes nhưng không được gọi từ LMS app
- **Fix:** Add `courses` tab vào `STUDENT_NAV`, implement `CoursesTab` calling `trpc.enrollment.mine` (cần thêm student-scoped query — xem Q4)

---

## 3. HIGH Priority Gaps — Sprint tới

### Business Logic Bugs
| # | File | Issue | Fix |
|---|------|-------|-----|
| H1 | `enrollment.ts:32-46` | Không check duplicate enrollment → double records | `findFirst` check trước `create` với `{ classBatchId, studentId, archivedAt: null }` |
| H2 | `assessment.ts:100-119` | No period filter → grades từ ALL time | Filter `grade.findMany` + `attendance.findMany` bằng date range từ `periodKey` |
| H3 | `submission.ts:150-165` | Re-submit graded submission reset teacher's grade silently | Status guard + P2025 try/catch |
| H4 | `crm.ts:198-216` (`opportunityReopen`) | WON deals có thể reopen → corrupt commission | Block if `stage === 'O5_ENROLLED' && closedAt != null` |
| H5 | `crm.ts:177` (`opportunityMarkLost`) | Guard dùng AND → WON deal có thể mark lost | Replace với check riêng biệt cho WON và LOST |
| H6 | `payroll.ts:178` | `workdays` có thể > `standardDays` → prorate > 100% | Add cross-field `.refine(v => v.workdays <= v.standardDays)` |
| H7 | `schedule.ts:23-48` (`addSlot`) | Không validate `startTime < endTime` | Add `.refine(v => v.startTime < v.endTime)` |
| H8 | `class-batch.ts:197-243` | Reopen không restore cancelled sessions | Add `classSession.updateMany` restore sau parent meetings restore |

### Database Constraints
| # | Model | Issue | Fix |
|---|-------|-------|-----|
| H9 | `CoursePrice` | Không unique trên `(facilityId, courseId, effectiveFrom)` → non-deterministic pricing | `@@unique([facilityId, courseId, effectiveFrom])` |
| H10 | `SalaryRate` | Không unique trên `(userId, effectiveFrom)` → non-deterministic payslip | `@@unique([userId, effectiveFrom])` |
| H11 | `Opportunity.contact` | `onDelete: Cascade` → delete contact xóa mọi commission history | Change to `Restrict` |
| H12 | `ClassBatch → Exercise → Submission → Grade` | Triple cascade → một SQL delete xóa mọi grades | Change `Exercise.batch onDelete` to `Restrict` |
| H13 | `ParentAccount` | Cả `email` và `phone` đều nullable → unrecoverable accounts | `CHECK (email IS NOT NULL OR phone IS NOT NULL)` |

### Security Gaps
| # | Issue | Fix |
|---|-------|-----|
| H14 | Cookies `secure: NODE_ENV === 'production'` | Change to `COOKIE_SECURE !== 'false'`; default true |
| H15 | `record_follower` không có RLS | Enable RLS + policy `USING (user_id::text = current_setting('app.user_id','t') OR app_is_super_admin())` |
| H16 | Nginx thiếu security headers | Thêm `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` |
| H17 | Redis không có auth trong `docker-compose.prod.yml` | `command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}']` |
| H18 | `.env.production.example` có `DB_APP_PASSWORD=cmc_app` | Change to `CHANGE_ME_STRONG_APP_PASSWORD` |

### UI Role Gate Leaks
| # | File | Issue |
|---|------|-------|
| H19 | `apps/teaching/src/level-approval-panel.tsx` | Không có role check — mọi staff có thể approve level-up |
| H20 | `apps/teaching/src/certificate-panel.tsx` | Không có role check — mọi staff có thể issue certificate |
| H21 | `apps/admin/src/shell.tsx` | `org` + `guardians` nav visible cho mọi role kể cả `sale`, `cskh` |
| H22 | `apps/admin/src/finance-panel.tsx` | `receiptList` không filter `facilityId` → cross-facility data leak |
| H23 | `apps/teaching/src/assessment-panel.tsx` | `student.list` không filter facilityId → cross-facility student list |

---

## 4. Missing Features (Backend ↔ UI Gaps)

### Backend có, UI thiếu (procedures defined nhưng không được call)
| Router | Missing procedures | Nơi cần add UI |
|--------|-------------------|----|
| `finance.ts` | `priceCreate`, `priceList`, `voucherCreate`, `voucherList` | `apps/admin/src/finance-panel.tsx` — operators phải dùng raw DB để set giá |
| `payroll.ts` | `profileUpsert`, `rateCreate`, `rateList`, `payslipCompute`, `payslipFinalize`, `payslipMarkPaid`, `payslipReopen`, `payslipPeriodSummary` | `apps/admin/src/payroll-panel.tsx` — chỉ có bulk pay, không có lifecycle |
| `crm.ts` | `contactList` | `apps/admin/src/crm-panel.tsx` — CRM contacts write-only |
| `aftersale.ts` | `assign` | `apps/admin/src/cskh-panel.tsx` — tasks mãi unassigned |
| `parent-meeting.ts` | `setSchedule` | `apps/teaching/src/App.tsx` MeetingsTab — không confirm datetime |
| `rewards.ts` | `giftCreate`, `review` | Teaching/admin — redemption mắc kẹt `pending` mãi mãi |

### UI có, Backend/API thiếu
| Panel | Gap |
|-------|-----|
| `apps/admin/src/App.tsx` | Không có student management panel — student chỉ tạo được qua seed |
| `apps/lms/src/student-view.tsx` | Không có `enrollment.mine` student-scoped query |
| `apps/lms/src/parent-view.tsx:445-451` | `notifications` tab là stub — chỉ render `LevelHistoryCard` |

### Bug trực tiếp trong shared component
- **`packages/ui/src/badge-shelf.tsx:38`:** `b.badge.iconUrl ? '' : '🏅'` — truthy branch emit empty string, badges không hiển thị icon
- **`packages/db/src/seed-demo.ts`:** Không có `CompensationPolicy` row → payroll module throws trong dev/staging

---

## 5. Cần Quyết Định Từ User (5 questions)

### Q1 — Rate-limit layer: Nginx hay Redis?
Hệ thống chạy single-instance hay horizontally scaled? 
- **Single:** Nginx `limit_req_zone` đủ, rẻ, không dependency
- **Multi-instance:** Cần Redis counter dùng chung. Redis đã có trong `docker-compose.prod.yml` nhưng `REDIS_URL` chưa được reference trong source code nào

→ **Chọn phương án nào để tôi implement C1?**

### Q2 — KPI score: Manual HR entry hay Callio-computed?
Hiện tại `payslipCompute` nhận `kpiScore: z.number(0-100)` từ HR nhập tay. Infrastructure Callio (`callio-client.ts`, `kpi.ts`, `kpi-authz.ts`) đã build nhưng chưa wire.
- **(a)** Manual entry intentional cho phase 1, Callio defer sang sau
- **(b)** Cần wire Callio trước khi ship payroll

### Q3 — Six orphaned teaching nav keys: standalone view hay ClassDetail tabs?
`schedule`, `sessions`, `attendance`, `enrollment`, `meetings`, `classlog` hiện render blank. Ba option:
- **(a)** Mỗi key = standalone cross-class view (e.g., global attendance list across all batches)
- **(b)** Nav items là shortcuts navigate vào ClassDetail + select tab
- **(c)** Remove nav items và expose chỉ qua ClassDetail

### Q4 — Student enrollment visibility trong LMS?
LMS positioned là homework platform. Backend `enrollment` router yêu cầu `quan_ly`/`sale` roles.
- Students có cần thấy danh sách khóa học/lớp đang học trong LMS app không?
- Nếu có: cần thêm `enrollment.mine` endpoint với student auth
- Nếu không: document rằng enrollment info chỉ visible qua admin/teaching app

### Q5 — StarTransaction manual reference: optional hay required?
Manual star adjustments (type=`manual`) có bắt buộc cần reference ID không?
- **Required:** Make `reference NOT NULL` globally
- **Optional:** Partial unique index (chỉ deduplicate khi reference IS NOT NULL)

---

## 6. Recommended Next Steps (Priority Order)

### Tuần này — Chặn go-live (không cần user decision)
1. **C4** — Add `USER cmc` vào `apps/api/Dockerfile` — 5 phút
2. **C2** — Remove/feature-flag `KpiEvaluationPanel` khỏi admin build — ngăn runtime crash
3. **C6** — Add entity whitelist check vào `audit.timeline` — copy pattern từ `postNote`
4. **C7** — Copy heartbeat session re-validate từ `/sse/staff` vào `/sse/notifications`
5. **H19/H20** — Add role guard vào `level-approval-panel.tsx` và `certificate-panel.tsx`
6. **Badge bug** — Fix `packages/ui/src/badge-shelf.tsx:38` — one-line fix, visible regression

### Sau Q1-Q5 được trả lời
7. **C1** — Rate limiting (sau Q1)
8. **C3** — Six blank nav keys (sau Q3)
9. **C10** — Student course view (sau Q4)
10. **C5** — StarTransaction partial unique (sau Q5)

### Sprint tới — Data Integrity
11. **H1** — Duplicate enrollment guard
12. **H2** — Assessment period filter (critical correctness bug)
13. **H9/H10** — CoursePrice + SalaryRate unique constraints
14. **H11/H12** — Cascade deletes → Restrict
15. **H13** — ParentAccount check constraint
16. **C8** — Auth integration tests
17. **H22** — Finance panel facilityId filter
18. **Seed** — Add `CompensationPolicy` row vào `seed-demo.ts`

### Sprint sau — Feature Completeness
19. Wire price + voucher management UI trong `finance-panel.tsx`
20. Wire payslip lifecycle UI trong `payroll-panel.tsx` (compute → finalize → markPaid)
21. Wire `afterSale.assign` và `rewards.review` UI
22. Add parent meeting `setSchedule` form trong Teaching MeetingsTab
23. Add attendance RLS behavioral test

---

## Unresolved Questions
- Q1: Rate-limit layer ownership (user decision needed)
- Q2: KPI manual vs Callio (user decision needed)
- Q3: Teaching nav intent (user decision needed)
- Q4: Student enrollment visibility in LMS (user decision needed)
- Q5: StarTransaction `manual` reference requirement (user decision needed)
