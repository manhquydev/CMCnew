# Attendance System Gap Closure — Implementation Plan

**Status:** 📋 Ready for review
**Created:** 2026-06-30
**Lane:** High-Risk (Security, Public contracts, RLS, Multi-domain)
**Branch:** develop (verified — not on main)

## Context

Rà soát bởi 4 review agent (Backend/Frontend/Security/Test) phát hiện hệ thống chấm công
(work shift + attendance) đã triển khai phần lõi nhưng còn gap CRITICAL/HIGH. Plan này
đóng toàn bộ gap theo dependency order.

## Architecture Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Security fixes trước Admin UI | UI/tests phụ thuộc API ổn định |
| 2 | RLS entry dùng policy join-parent (EXISTS shift_registration) | Bảng không có facility_id trực tiếp — pattern `opportunity_assignment` |
| 3 | push-after-commit: capture push fn ra ngoài withRls, gọi sau return | Tuân thủ contract emitStaffNotif (tx:15-21) |
| 4 | approve authz: check managerId/nextManagerId OR super_admin | Đúng nghĩa "manager được gán duyệt", không phải bất kỳ manager nào |
| 5 | shiftConfig.update/archive: implement proc tối thiểu (không xóa entry) | UI admin cần sửa/xóa nhóm ca; orphaned permission → thành proc thật |
| 6 | saveDay: xóa dead code, dùng toggle có busy-guard + rollback state | KISS — 1 đường persist thay 2 |
| 7 | Seed FacilityNetwork: 1 IP mẫu/facility (label "WiFi VP") | Để checkin-panel không luôn báo "ngoài mạng" ở dev |
| 8 | Test: int.test.ts pattern (vitest + Program + withRls) | Khớp 67 test file hiện có |

## Files to Create/Modify

### NEW (9 files)
| File | Purpose |
|------|---------|
| `packages/db/prisma/migrations/*_shift_entry_rls/migration.sql` | RLS cho shift_registration_entry (join-parent) |
| `apps/admin/src/facility-network-panel.tsx` | Admin UI cấu hình IP whitelist |
| `apps/admin/src/shift-config-panel.tsx` | Admin UI cấu hình nhóm ca + mẫu ca |
| `apps/api/test/shift-reg-ownership.int.test.ts` | Test: sửa phiếu người khác → FORBIDDEN |
| `apps/api/test/shift-reg-approve-authz.int.test.ts` | Test: sai manager duyệt → FORBIDDEN |
| `apps/api/test/shift-reg-supersede.int.test.ts` | Test: approve mới → cũ cancelled |
| `apps/api/test/checkin-ip-penalty.int.test.ts` | Test: IP validation + penalty muộn/sớm/ca đêm |
| `apps/api/test/rls-shift-cross-facility.int.test.ts` | Test: RLS cross-facility punch/registration |
| `apps/api/test/shift-config-crud.int.test.ts` | Test: shiftConfig update/archive + facilityNetwork CRUD |

### MODIFY (8 files)
| File | Change |
|------|--------|
| `apps/api/src/routers/shift-registration.ts` | +ownership check (3 proc), +approve authz, fix push-after-commit (4 proc) |
| `apps/api/src/routers/shift-config.ts` | +update proc, +archive proc (xóa orphaned) |
| `apps/api/src/routers/check-in-out.ts` | fix push-after-commit (punch), +shiftTemplateId link |
| `apps/admin/src/shift-reg-detail-panel.tsx` | xóa saveDay dead code, toggle busy-guard + rollback |
| `apps/admin/src/shift-reg-list-panel.tsx` | +nút Duyệt/Từ chối cho manager |
| `apps/admin/src/App.tsx` | +2 render case (facility-network, shift-config) |
| `apps/admin/src/shell.tsx` | +2 section keys + group "Quản trị" |
| `apps/admin/src/nav-permissions.ts` | +2 nav gates (facilityNetwork.list, shiftConfig.create) |
| `packages/db/src/seed.ts` | +seedFacilityNetwork (1 IP/facility) |

## Phases

### Phase A: Backend Security Fixes
- [ ] shift-registration.ts: updateEntry/submit/withdraw + ownership check (`reg.userId !== ctx.session.userId → FORBIDDEN`)
- [ ] shift-registration.ts: approve/reject + authz check (`ctx.user !== managerId && !== nextManagerId && !super → FORBIDDEN`)
- [ ] shift-registration.ts: fix push-after-commit (submit/withdraw/approve/reject) — capture push fn, gọi sau withRls return
- [ ] check-in-out.ts: fix push-after-commit (punch) — same pattern
- [ ] shift-config.ts: +update proc (superAdminProcedure), +archive proc (soft-delete archivedAt)
- [ ] check-in-out.ts: punch link shiftTemplateId (lookup approved shift entry cho today)
- **Risk:** HIGH — thay đổi authorization logic, ảnh hưởng workflow duyệt
- **Est:** 1.5h

### Phase B: RLS + Seed
- [ ] Migration `shift_entry_rls`: ENABLE RLS + policy join-parent trên shift_registration_entry
- [ ] seed.ts: +seedFacilityNetwork — 1 IP mẫu/facility (127.0.0.1 cho dev)
- [ ] Verify rls-coverage.int.test.ts vẫn pass (entry không có facility_id → test mù, OK)
- **Risk:** MEDIUM — RLS migration, cần test cross-facility
- **Est:** 0.5h

### Phase C: Admin Config UI
- [ ] facility-network-panel.tsx: DataTable list IP + form thêm (ipAddress, label) + nút xóa (soft-delete)
- [ ] shift-config-panel.tsx: list nhóm ca + mẫu ca; form tạo nhóm (code, name, selectionMode); form tạo mẫu ca; nút sửa/xóa
- [ ] shell.tsx: +section keys 'facility-network', 'shift-config'
- [ ] nav-permissions.ts: +2 gates (facilityNetwork.list, shiftConfig.create)
- [ ] App.tsx: +2 render case
- [ ] Loại bỏ `as any` trong 2 panel mới (dùng trpc typed)
- **Risk:** MEDIUM — UI mới, cần khớp pattern Mantine Table/Card
- **Est:** 2h

### Phase D: Frontend Fixes
- [ ] shift-reg-detail-panel.tsx: xóa saveDay, toggle thêm busy-guard + rollback local state khi mutate fail
- [ ] shift-reg-list-panel.tsx: +cột action cho manager (Duyệt/Từ chối) — gate theo role
- [ ] Loại bỏ `as any` trong shift-reg-list/detail + checkin-panel (trpc typed)
- **Risk:** LOW — UI behavior, không đổi API
- **Est:** 1h

### Phase E: Tests
- [ ] shift-reg-ownership.int.test.ts: staff A sửa phiếu nháp của staff B → FORBIDDEN
- [ ] shift-reg-approve-authz.int.test.ts: manager X (không phải managerId) duyệt → FORBIDDEN; managerId duyệt → OK
- [ ] shift-reg-supersede.int.test.ts: approve phiếu mới → phiếu approved cũ = cancelled + supersededById
- [ ] checkin-ip-penalty.int.test.ts: IP trong whitelist → method 'ip'; ngoài → 'manual'; penalty 500đ/p, 1000đ/p; ca đêm
- [ ] rls-shift-cross-facility.int.test.ts: staff facility A query punch/registration facility B → rỗng
- [ ] shift-config-crud.int.test.ts: shiftConfig.update/archive + facilityNetwork create/delete + audit log
- [ ] Run full suite: npx vitest run apps/api/test — 100% pass
- **Risk:** LOW — test mới, không đổi production code
- **Est:** 2h

## Acceptance Gate (tất cả phải pass)

1. Admin super_admin thấy + dùng được 2 panel cấu hình (IP + ca) qua UI — không cần sửa code/SQL
2. Staff A không sửa/nộp/rút phiếu của staff B (FORBIDDEN)
3. Manager không được gán không duyệt được phiếu (FORBIDDEN)
4. Approve phiếu mới → phiếu cũ auto-cancel (supersede)
5. Punch trong IP whitelist → method 'ip'; ngoài → 'manual' + thông báo manager
6. Penalty tính đúng (muộn/ sớm/ ca đêm)
7. RLS: staff facility A không thấy data facility B (kể cả shift_registration_entry qua join)
8. 6 test file mới pass + 67 test cũ vẫn pass = 100%
9. Permission parity test pass (registry↔snapshot)
10. Type-check sạch (npx tsc --noEmit -p apps/api/tsconfig.json + apps/admin)

## Verification Commands
```bash
cd D:/project/CMCnew
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/admin/tsconfig.json
npx vitest run apps/api/test
npx prisma validate --schema packages/db/prisma/schema.prisma
```
