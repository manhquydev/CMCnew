---
phase: 1
title: "Schema & migration"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Schema & migration

## Overview

Thêm model `ManualAttendanceTicket` (1 phiếu/người/ngày ICT) + migration. Nền cho toàn plan.

## Requirements

- Functional: bảng lưu phiếu chấm-ngoài-WiFi theo ngày; unique 1 phiếu/người/ngày; liên kết approver.
- Non-functional: **BẮT BUỘC bật RLS + policy isolation theo facility** (khớp mọi bảng tenant trong repo, gồm `time_punch`). Runtime nối DB bằng role `cmc_app` (non-owner); bảng KHÔNG bật RLS sẽ trả toàn bộ row mọi cơ sở → rò `reason` (lý do nghỉ, nhạy cảm) chéo facility. Đây KHÔNG phải "chỉ thêm bảng" — vẫn thêm bảng mới nhưng có RLS.
- Index phục vụ truy vấn pending theo facility.

## Architecture

```prisma
model ManualAttendanceTicket {
  id           String    @id @default(uuid()) @db.Uuid
  facilityId   Int       @map("facility_id")
  userId       String    @map("user_id") @db.Uuid
  dateKey      String    @map("date_key")      /// "YYYY-MM-DD" theo ICT
  reason       String
  status       String    @default("pending")   /// pending | approved | rejected
  approvedById String?   @map("approved_by_id") @db.Uuid
  approvedAt   DateTime? @map("approved_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@unique([userId, dateKey])
  @@index([facilityId, status])
  @@map("manual_attendance_ticket")
}
```

- Không thêm quan hệ Prisma bắt buộc tới `TimePunch` (tránh migration nặng); punch tra phiếu theo `(userId, dateKey)`. KHÔNG thêm cột `ticketId` trên TimePunch (YAGNI — tra theo `(userId,dateKey)` đủ; thêm cột là `ALTER TABLE time_punch`, không cần).

**RLS (bắt buộc, khớp `20260630140000_work_shift_rls`):**

```sql
ALTER TABLE "manual_attendance_ticket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY manual_attendance_ticket_isolation ON "manual_attendance_ticket"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
```
> Đối chiếu chính xác helper (`app_is_super_admin`/`app_principal_kind`/`app_facility_ids`) với migration RLS hiện có trước khi viết — dùng đúng tên hàm repo đang dùng.

## Related Code Files

- Modify: `packages/db/prisma/schema.prisma` (thêm model)
- Create: `packages/db/prisma/migrations/<timestamp>_manual_attendance_ticket/migration.sql`
- Create: `docs/decisions/NNNN-manual-attendance-daily-ticket.md` (decision record — API shape + authorization + data ownership đổi)

## Implementation Steps

1. **Test-first**: (a) test unique `(userId, dateKey)` phải lỗi; (b) test RLS: 2 phiếu 2 facility khác nhau, principal staff facility A `findMany` chỉ thấy phiếu facility A (dùng helper set `app.facility_ids` như test RLS `time_punch` hiện có). Chạy → đỏ.
2. Thêm model `ManualAttendanceTicket` vào `schema.prisma`.
3. `pnpm --filter @cmc/db prisma migrate dev --name manual_attendance_ticket` (tạo migration). **Thêm thủ công** khối `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` vào file migration (Prisma không tự sinh RLS). Kiểm SQL: `CREATE TABLE` + index + RLS policy, KHÔNG alter bảng khác.
4. `gitnexus_impact` không áp dụng (bảng mới) — chỉ chạy `prisma generate`.
5. Viết decision record: vì sao phiếu-theo-ngày, đổi luồng duyệt, ảnh hưởng report.
6. Chạy lại test bước 1 → xanh.

## Success Criteria

- [ ] Migration `CREATE TABLE` + `@@unique` + index + **RLS ENABLE + policy isolation** chạy sạch trên dev.
- [ ] Test unique `(userId, dateKey)` xanh.
- [ ] Test RLS: staff facility A không đọc được phiếu facility B; super_admin đọc hết.
- [ ] `pnpm --filter @cmc/db typecheck`/`prisma generate` sạch.
- [ ] Decision record tồn tại và mô tả đúng thay đổi.

## Risk Assessment

- Từng có lỗi migrate-staleness (Jenkins) → migration thêm bảng mới + RLS policy (không alter bảng cũ), rollback `DROP TABLE manual_attendance_ticket;` (drop luôn policy). Không down-migration tự động vì Prisma không dùng.
- Prod chain migration: verify `migrate status` 0-drift sau khi apply trên dev-mirror trước khi promote (thuộc gate promote, không phải plan này).
