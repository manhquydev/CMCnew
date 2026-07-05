# Phase 02 — Staff & class setup (Stages 1-3)

## Context links
- Design: `plans/reports/brainstorm-260705-1006-e2e-full-lifecycle-walkthrough-guide-report.md`
- Decisions: `docs/decisions/0031-staff-password-login-parallel-to-sso.md`, `docs/decisions/0036-class-code-facility-program-format.md`

## Overview
- Date: 2026-07-05
- Description: HR/super_admin creates teacher + sale/CSKH + ke_toan (mandatory personal email/contact), sets passwords, and each staff verifies password login. Manager creates a class from a curriculum course (auto code, weekly slots, dates), then presses "Sinh lịch" to generate ClassSessions.
- Priority: P1
- Implementation status: pending
- Review status: not reviewed

## Key Insights
- `user.create` now requires EmploymentProfile fields atomically incl. mandatory personal email + contact (seed mirrors this: `packages/db/src/seed.ts:57-60`; shipped per class-code decision 0036 gap-fill). Missing fields will block creation — this is expected current behavior to document.
- Password login: after creating a staff, an explicit set-password action is required (decision 0031) before that staff can log in. Verify each staff logs in at :5173 with the password just set — this is stage 1's hard success gate and the #1 risk.
- Class code auto-generates per `docs/decisions/0036` format (facility+program). Course dropdown is curriculum-only — pick UCREA or Bright I.G (Black Hole has no content).
- "Sinh lịch" = `schedule.generateSessions` (`apps/api/src/routers/schedule.ts`), a manual button. `class-batch.create` already captured `startDate/endDate/slots[]`; generateSessions enumerates ClassSession over the date range. Guide documents this as a REQUIRED manual step (current behavior; auto-gen is out of scope).
- Attendance later depends hard on sessions existing (brainstorm-0944) — if generateSessions is skipped, stage 8 attendance is impossible.

## Requirements
- 3 staff live-created: giao_vien (teacher), sale or cskh, ke_toan. Each with mandatory personal email + contact.
- Each staff password set + login-verified.
- 1 class created on UCREA or Bright I.G with ≥1 weekly slot + start/end dates; auto code correct format.
- ClassSessions generated matching slot count over the date range.

## Architecture
- Admin ERP `http://localhost:5173`: HR/staff module (create staff, set password), class workspace (create class + Sinh lịch).
- Routers: `apps/api/src/routers/user.ts` (create + setPassword), `apps/api/src/routers/schedule.ts` (generateSessions), class-batch create (curriculum course dropdown).
- Assignment of teacher to class needed so teacher sees it in stage 8.

## Related code files
- `apps/api/src/routers/user.ts` (create staff, setPassword, ROLE_LABELS)
- `apps/api/src/routers/auth.ts:24-38` (login gate — verify)
- `apps/api/src/routers/schedule.ts` (generateSessions; conflict-check `schedule.ts:174-219`)
- `apps/admin/src/class-workspace.tsx` (class create + enroll UI)
- `packages/db/src/seed-curriculum.ts` (UCREA/Bright I.G courses)

## Implementation Steps
1. Login super_admin (or HR) at :5173. Navigate to staff/HR module.
2. Create teacher: role giao_vien, fill mandatory personal email + contact. Screenshot the create form (show required fields) + success.
3. Create sale (or cskh) and ke_toan the same way. Screenshot each.
4. For each of the 3 staff: set a password (record which UI action — e.g. staff profile "Đặt mật khẩu"). Screenshot.
5. Verify login per staff: open a fresh browser/incognito → :5173 → login with staff email + password → expect success (NOT the SSO 403). Screenshot each staff's landing. If 403 → blocking bug (STAFF_PASSWORD_LOGIN not loaded, or setPassword didn't persist) → fix + commit.
6. As manager (director/super_admin), create a class:
   - Course dropdown → pick UCREA or Bright I.G level with content.
   - Set weekly slots (e.g. 2 slots/week), start + end dates.
   - Assign the teacher created in step 2.
   - Save. Screenshot the auto-generated class code — verify format per decision 0036.
7. Press "Sinh lịch" (generateSessions). Screenshot the confirmation + resulting session list.

## Verify queries (read-only)
- Staff created: `SELECT email, role FROM "User" WHERE role IN ('giao_vien','sale','cskh','ke_toan');`
- Password set: staff `passwordHash IS NOT NULL`.
- Class + code: `SELECT code, "startDate", "endDate" FROM "ClassBatch" ORDER BY "createdAt" DESC LIMIT 1;` — check code format.
- Sessions generated: `SELECT count(*) FROM "ClassSession" WHERE "classBatchId" = <id>;` — matches slots × weeks in range.

## Todo list
- [ ] teacher / sale(or cskh) / ke_toan created with mandatory fields — screenshots
- [ ] password set per staff — screenshots
- [ ] each staff login-verified at :5173 (no SSO 403) — screenshots
- [ ] class created on UCREA/Bright I.G, teacher assigned, auto code verified
- [ ] Sinh lịch pressed, ClassSessions verified vs slot count
- [ ] guides written: `01-hr-staff/`, `02-class-create/`, `03-generate-sessions/` (roles: HR/super_admin, Quản lý)

## Success Criteria
- 3 staff exist, each logs in with password (stage 1 gate met).
- 1 class with correct auto code + assigned teacher.
- ClassSession count matches expected slots over date range.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Staff login 403 despite flag | Med | High | verify flag loaded (P1 step 7); confirm setPassword persisted `passwordHash`; fix+commit if code bug |
| Mandatory field validation blocks create with unclear error | Med | Med | document exact required fields in guide; if error is misleading → log minor bug |
| Class code format wrong | Low | Med | cross-check vs decision 0036; if wrong → blocking bug, fix+commit |
| generateSessions produces 0 or duplicate sessions | Med | High | check slot/date inputs; conflict-check at schedule.ts:174-219; fix+commit if broken |
| Black Hole course picked (no content) | Low | Med | guide explicitly instructs UCREA/Bright I.G |

## Security Considerations
- Use throwaway staff passwords (e.g. `Cmc@2026test`) — never a real credential. Screenshots must not show the password field value in plain text (mask or crop).
- Personal email fields use test values, not real staff PII.

## Next steps
Proceed to Phase 03 (CRM O1→O5, receipt create+approve, atomic student provisioning, parent email).
