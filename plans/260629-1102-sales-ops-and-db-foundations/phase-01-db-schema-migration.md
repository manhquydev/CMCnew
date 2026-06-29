# Phase 01 — Schema + migration

## Context
- Schema: `packages/db/prisma/schema.prisma` (single source of truth).
- Models đụng tới: `Contact`, `Opportunity` (+ enum mới), `Attendance`, `Submission`, `Enrollment`, `ClassSession`.
- Hiện trạng: `Contact.source String?` (free-text); `Opportunity.lostReason String?` (free-text); bảng lớn chỉ có `@@index([facilityId])` + unique.

## Requirements / thay đổi
1. **B2 attribution** — thêm vào `Contact`:
   - `medium String?` (vd: cpc | organic | referral | event)
   - `campaign String?` (mã/tên chiến dịch)
   - Giữ `source` (không phá contract). Không thêm Zalo/Meta (đã loại).
2. **B4 lost-reason** — enum mới + đổi cột:
   ```prisma
   enum LostReason { price schedule distance competitor no_response not_ready other }
   ```
   - `Opportunity.lostReason` đổi `String?` → `LostReason?` (giữ nullable).
   - `Opportunity.lostNote String?` (ghi chú tự do tuỳ chọn, thay chỗ free-text cũ).
3. **B1 assignment log** — model mới (append-only):
   ```prisma
   model OpportunityAssignment {
     id            String   @id @default(uuid()) @db.Uuid
     facilityId    Int      @map("facility_id")
     opportunityId String   @map("opportunity_id") @db.Uuid
     opportunity   Opportunity @relation(fields:[opportunityId],references:[id],onDelete:Cascade)
     fromOwnerId   String?  @map("from_owner_id") @db.Uuid
     toOwnerId     String?  @map("to_owner_id")   @db.Uuid
     assignedById  String   @map("assigned_by_id") @db.Uuid
     reason        String?
     createdAt     DateTime @default(now()) @map("created_at")
     @@index([facilityId])
     @@index([opportunityId])
     @@map("opportunity_assignment")
   }
   ```
   - Thêm quan hệ ngược `assignments OpportunityAssignment[]` vào `Opportunity`.
4. **E3 indexes** (theo truy vấn thật, không trùng unique-prefix sẵn có):
   - `Attendance`: `@@index([enrollmentId])` (tỉ lệ chuyên cần theo HS).
   - `Submission`: `@@index([studentId])` (bài của HS).
   - `Enrollment`: `@@index([studentId])` ("lớp của tôi").
   - `ClassSession`: `@@index([facilityId, sessionDate])` (quét theo ngày/cron).

## Migration steps (1 migration, expand→backfill→constrain)
1. `pnpm db:up` (Postgres dev) nếu cần.
2. Sửa schema theo trên.
3. Tạo migration: thêm cột `medium`,`campaign`,`lost_note`, bảng `opportunity_assignment`, 4 index — đều **additive**.
4. Với `lost_reason` đổi kiểu: trong migration SQL — (a) thêm cột enum mới tạm `lost_reason_new`; (b) backfill: mọi giá trị free-text cũ → `other`, NULL giữ NULL; (c) drop cột cũ, rename `lost_reason_new` → `lost_reason`. (Prisma sẽ cần raw SQL chèn tay trong file migration — review kỹ.)
5. `pnpm prisma generate`.

## Files
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_sales_ops_foundations/migration.sql` (chỉnh tay phần backfill enum)

## Validation
- `pnpm prisma migrate dev` chạy sạch trên DB trống + trên DB có seed.
- Kiểm: dữ liệu lostReason cũ (nếu seed có) → `other`; 4 index xuất hiện (`\di` hoặc introspection).
- `pnpm --filter @cmc/db typecheck`.

## Risks / rollback
- Đổi kiểu cột enum là điểm rủi ro duy nhất → expand/backfill/constrain trong cùng migration; test trên seed trước.
- Rollback: `migrate resolve --rolled-back` + revert schema (chưa có prod data cho field mới).
