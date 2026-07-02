# Work Shift Registration + Attendance -- Data Model Design

**Status:** DRAFT -- awaiting review
**Date:** 2026-06-30
**Plan:** `plans/260630-1919-work-shift-registration/`
**Role:** Data Model Design (Agent 02)

---

## 1. Assumptions Challenged

### Assumption 1: "KINH DOANH" and "GIAO VIEN" are fixed groups
**Challenge:** Hardcoding these as an enum or static list prevents adding new shift groups (e.g., "PART_TIME") without schema migration.
**Decision:** Model `ShiftGroup` as a database table, not an enum. The `selectionMode` field determines if the group allows single or multiple shift selection per day. Adding a new group = INSERT, not ALTER TABLE.

### Assumption 2: Flat vs hierarchical entries
**Challenge:** A 3-level hierarchy (Sheet -> Day -> Shift) mirrors the UI but adds query complexity. A flat structure (Sheet -> Entry[date+shift]) is simpler and still satisfies the constraint.
**Decision:** Flat structure. One `ShiftRegistrationEntry` per (registration, date, shift). A teacher registering 3 shifts/day for 22 weekdays = 66 rows. Postgres handles this fine.

### Assumption 3: Check-in MUST map to a registered shift
**Challenge:** Unregistered check-ins (overtime, emergency) would be rejected.
**Decision:** `TimeRecord.shiftTemplateId` and `shiftRegistrationId` are nullable. Unmatched check-ins are recorded and flagged for manager review.

### Assumption 4: IP restriction is a core requirement
**Challenge:** Mobile check-in (cellular data) makes IP-based validation unreliable.
**Decision:** Include `FacilityNetwork` as a simple IP whitelist model but treat it as advisory (not a hard gate). GPS/location can be added later as nullable fields on TimeRecord.


## 2. Alternatives Considered

### Alternative A: Single "fat" ShiftRegistration table with JSONB dates
Store dates as JSONB directly in ShiftRegistration.
- **Pros:** Single-table query, no joins for display.
- **Cons:** Cannot query "who works on 2026-07-15" without JSONB functions. No referential integrity on shiftTemplateId inside JSON. Violates DRY.
- **Verdict:** Rejected. This is the system of record for payroll; normalized tables, not JSONB blobs.

### Alternative B: Per-day ShiftRegistration (no sheet grouping)
One ShiftRegistration row per (user, date). Manager approves per-day.
- **Pros:** Simpler workflow. No sheet concept.
- **Cons:** Manager fatigue (approve 22 rows instead of 1 sheet). Cannot express batch replacement atomically.
- **Verdict:** Rejected. The sheet pattern (like KpiScore, Receipt) is proven in this codebase.

### Alternative C: Generic Calendar/Event model reuse
Reuse ClassSession/Attendance pattern: treat shifts as sessions and check-ins as attendance.
- **Pros:** Zero new models, reuses existing infrastructure.
- **Cons:** Staff attendance has fundamentally different semantics (voluntary check-in vs teacher-marked attendance, IP tracking, manager approval workflow, payroll linkage). Overloading ClassSession/Attendance would corrupt their invariants.
- **Verdict:** Rejected. Separate domain = separate models.

---

## 3. Complete Prisma Schema

All new models follow the exact conventions of the existing schema:
- facilityId on every table (RLS requires no joins)
- archivedAt for soft-delete (never hard-delete)
- createdAt @default(now()) on every table
- @@map("snake_case") table names
- @map("snake_case") on every field
- String @id @default(uuid()) @db.Uuid for primary keys
- DateTime @db.Date for date-only fields
- @@unique([facilityId, keyField]) for scoped uniqueness
- @@index([facilityId]) for RLS performance
- Audit via existing RecordEvent model (no new audit table needed)

---

### 3.1 ENUMS

```prisma
/// Trang thai phieu dang ky ca: draft -> submitted -> approved; cancelled la terminal.
enum ShiftRegistrationStatus {
  draft
  submitted
  approved
  cancelled
}

/// Loai su kien cham cong.
enum TimeRecordType {
  check_in
  check_out
}
```

**Why ShiftRegistrationStatus has no confirmed step:**
KpiScore has 4-step (draft->submitted->confirmed->approved) because KPI scoring involves 3 actors (employee submits, manager confirms numbers, director approves). Shift registration involves 2 actors (employee submits, manager approves). Adding a confirmed step would be unnecessary ceremony. If later needed, adding an enum value is backward-compatible.

---

### 3.2 ShiftGroup -- Nhom ca lam viec

```prisma
/// Nhom ca lam viec (vd: KINH DOANH, GIAO VIEN). Moi nhom quy dinh che do chon ca:
/// SINGLE = chon 1 ca/ngay. MULTIPLE = chon nhieu ca/ngay.
/// Facility-scoped de moi co so co the cau hinh nhom ca rieng.
model ShiftGroup {
  id            String   @id @default(uuid()) @db.Uuid
  facilityId    Int      @map("facility_id")
  code          String   /// Ma nhom: "KINH_DOANH", "GIAO_VIEN", ...
  name          String   /// Ten hien thi: "Kinh doanh", "Giao vien"
  selectionMode String   @map("selection_mode") /// "SINGLE" | "MULTIPLE"
  description   String?
  sortOrder     Int      @default(0) @map("sort_order")
  archivedAt    DateTime? @map("archived_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  templates     ShiftTemplate[]

  @@unique([facilityId, code])
  @@index([facilityId])
  @@map("shift_group")
}
```

**Design notes:**
- selectionMode is a String (not enum) so new modes can be added without migration. Application validates via Zod.
- code is unique per facility, not globally. Same pattern as ClassBatch.code.
- sortOrder controls display ordering in dropdowns (Ca sang=0, Ca chieu=1, Ca toi=2).

---

### 3.3 ShiftTemplate -- Mau ca trong nhom

```prisma
/// Mau ca lam viec (vd: "Ca sang 08:00-12:00"). Thuoc ve mot ShiftGroup.
/// startTime/endTime dang "HH:mm" (ICT) -- cung pattern ScheduleSlot.
model ShiftTemplate {
  id            String    @id @default(uuid()) @db.Uuid
  facilityId    Int       @map("facility_id")
  shiftGroupId  String    @map("shift_group_id") @db.Uuid
  shiftGroup    ShiftGroup @relation(fields: [shiftGroupId], references: [id], onDelete: Cascade)
  code          String    /// Ma ca: "CA_SANG", "CA_CHIEU", "CA_TOI"
  name          String    /// Ten hien thi: "Ca sang", "Ca chieu", "Ca toi"
  startTime     String    @map("start_time") /// "HH:mm" -- 08:00, 13:00, 17:30
  endTime       String    @map("end_time")   /// "HH:mm" -- 12:00, 17:00, 21:30
  color         String?   /// Ma mau hien thi tren calendar (hex)
  sortOrder     Int       @default(0) @map("sort_order")
  archivedAt    DateTime? @map("archived_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  registrationEntries ShiftRegistrationEntry[]
  timeRecords          TimeRecord[]

  @@unique([facilityId, code])
  @@unique([shiftGroupId, startTime]) /// Khong trung gio trong cung nhom
  @@index([facilityId])
  @@index([shiftGroupId])
  @@map("shift_template")
}
```

**Design notes:**
- color is optional -- enables calendar color-coding without hardcoding colors per shift.
- @@unique([shiftGroupId, startTime]) prevents overlapping shift times within a group.
- startTime/endTime stored as String matching the ScheduleSlot pattern. Application validates "HH:mm" format with Zod.

---

### 3.4 ShiftRegistration -- Phieu dang ky ca

```prisma
/// Phieu dang ky ca lam viec (1 phieu = 1 nhan vien, 1 khoang thoi gian).
/// Workflow: draft -> submitted -> approved. cancelled la terminal.
/// Khi phieu moi duoc approved, phieu cu bi huy (status=cancelled, supersededById tro den phieu moi).
model ShiftRegistration {
  id              String                  @id @default(uuid()) @db.Uuid
  facilityId      Int                     @map("facility_id")
  userId          String                  @map("user_id") @db.Uuid
  periodStart     DateTime                @map("period_start") @db.Date
  periodEnd       DateTime                @map("period_end") @db.Date
  status          ShiftRegistrationStatus @default(draft)
  note            String?

  /// Nguoi tao phieu (thuong la chinh nhan vien, co the la HR/quan ly tao ho).
  createdById     String?                 @map("created_by_id") @db.Uuid
  /// Nguoi submit phieu di.
  submittedById   String?                 @map("submitted_by_id") @db.Uuid
  submittedAt     DateTime?               @map("submitted_at")
  /// Nguoi duyet phieu (quan ly truc tiep hoac center_director).
  approvedById    String?                 @map("approved_by_id") @db.Uuid
  approvedAt      DateTime?               @map("approved_at")
  /// Nguoi huy phieu.
  cancelledById   String?                 @map("cancelled_by_id") @db.Uuid
  cancelledAt     DateTime?               @map("cancelled_at")
  cancelReason    String?                 @map("cancel_reason")

  /// Khi phieu nay duoc approved, phieu cu (cung user, overlapping ngay) bi set cancelled
  /// va supersededById = this.id. Self-referential FK de truy vet chuoi thay the.
  supersededById  String?                 @map("superseded_by_id") @db.Uuid
  supersededBy    ShiftRegistration?      @relation("RegistrationSupersede", fields: [supersededById], references: [id], onDelete: SetNull)
  supersededRegistrations ShiftRegistration[] @relation("RegistrationSupersede")

  createdAt       DateTime                @default(now()) @map("created_at")
  updatedAt       DateTime                @updatedAt @map("updated_at")

  entries         ShiftRegistrationEntry[]

  @@index([facilityId, userId, status])
  @@index([facilityId, periodStart, periodEnd])
  @@index([supersededById])
  @@map("shift_registration")
}
```

**Design notes:**
- userId has NO Prisma relation to AppUser/EmploymentProfile. This follows the KpiScore/Payslip/SalaryRate pattern (comment in schema: "userId la khoa, khong khai bao quan he de giu AppUser gon"). Application resolves user info at query time.
- createdById is the actor (can differ from userId when HR creates on behalf of employee).
- supersededById is a self-referential relation. When Sheet B is approved for the same user with overlapping dates, Sheet A gets status=cancelled + supersededById=B.id.
- updatedAt is included (unlike most existing models) because shift registrations are mutable in draft status.
- Activation logic lives in application layer: on approve, query all draft|submitted registrations for same user with overlapping periodStart..periodEnd, cancel them, set supersededById.

---

### 3.5 ShiftRegistrationEntry -- Chi tiet tung ngay+ca

```prisma
/// Moi dong = 1 ngay + 1 ca trong phieu dang ky.
/// GIAO VIEN chon nhieu ca/ngay -> nhieu dong cung date khac shiftTemplateId.
/// KINH DOANH chon 1 ca/ngay -> 1 dong/ngay.
model ShiftRegistrationEntry {
  id               String    @id @default(uuid()) @db.Uuid
  facilityId       Int       @map("facility_id")
  registrationId   String    @map("registration_id") @db.Uuid
  registration     ShiftRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)
  date             DateTime  @db.Date
  shiftTemplateId  String    @map("shift_template_id") @db.Uuid
  shiftTemplate    ShiftTemplate @relation(fields: [shiftTemplateId], references: [id], onDelete: Restrict)
  createdAt        DateTime  @default(now()) @map("created_at")

  @@unique([registrationId, date, shiftTemplateId]) /// Khong dang ky trung ca trong cung ngay cua cung phieu
  @@index([facilityId])
  @@index([facilityId, date]) /// Tra cuu "ai lam viec ngay X"
  @@index([shiftTemplateId])
  @@map("shift_registration_entry")
}
```

**Design notes:**
- @@unique([registrationId, date, shiftTemplateId]) prevents duplicate shift registration for the same day within a sheet. Application enforces the selectionMode constraint: SINGLE groups cannot have >1 entry per date.
- onDelete: Restrict on shiftTemplateId prevents deleting a shift template that is referenced by registrations. Templates should be soft-deleted (archivedAt) instead.
- facilityId is denormalized (also present on parent ShiftRegistration). This is intentional -- every table carries facilityId for RLS WHERE facility_id = $1 without joins.
- @@index([facilityId, date]) supports the core query: "who is working at facility X on date Y?" -- needed for manager dashboard and check-in matching.

---

### 3.6 TimeRecord -- Ban ghi check-in/check-out

```prisma
/// Ban ghi cham cong -- moi lan check-in hoac check-out la 1 record.
/// Map vao ca da dang ky (shiftTemplateId) de xac dinh dung gio/muon/vang.
model TimeRecord {
  id                    String         @id @default(uuid()) @db.Uuid
  facilityId            Int            @map("facility_id")
  userId                String         @map("user_id") @db.Uuid
  eventType             TimeRecordType @map("event_type")
  timestamp             DateTime       /// Thoi diem check-in/check-out (theo dong ho server)
  ipAddress             String?        @map("ip_address") /// IP cua thiet bi check-in
  userAgent             String?        @map("user_agent") /// UA string de chong gia mao
  latitude              Float?         /// GPS lat (neu check-in tu mobile)
  longitude             Float?         /// GPS lon (neu check-in tu mobile)
  locationAccuracy      Float?         @map("location_accuracy") /// Do chinh xac GPS (met)

  /// Map vao ca da dang ky (nullable: check-in ngoai dang ky van duoc ghi nhan).
  shiftRegistrationId   String?        @map("shift_registration_id") @db.Uuid
  shiftTemplateId       String?        @map("shift_template_id") @db.Uuid
  shiftTemplate         ShiftTemplate? @relation(fields: [shiftTemplateId], references: [id], onDelete: SetNull)

  /// Ket qua matching (tinh tai thoi diem check-in, luu de khoi tinh lai).
  matchStatus           String?        @map("match_status") /// "on_time" | "late" | "early" | "no_shift" | null (chua map)
  lateMinutes           Int?           @map("late_minutes") /// So phut di muon (neu matchStatus=late)

  note                  String?
  createdAt             DateTime       @default(now()) @map("created_at")

  @@index([facilityId, userId, timestamp])
  @@index([facilityId, timestamp]) /// Bao cao cham cong theo ngay
  @@index([shiftRegistrationId])
  @@index([userId, timestamp]) /// Tra cuu lich su cham cong cua 1 user
  @@map("time_record")
}
```

**Design notes:**
- matchStatus is stored at write time to avoid recomputing on every read. Values:
  - "on_time" -- within grace period of shift start (e.g., 5 min before to 5 min after)
  - "late" -- after grace period
  - "early" -- before grace period (clocked in too early)
  - "no_shift" -- no matching ShiftRegistrationEntry found for today
  - null -- not yet matched (for CHECK_OUT records or legacy data)
- ipAddress and userAgent stored for audit. IP can be validated against FacilityNetwork at the application layer.
- GPS fields are optional because not all check-ins are from mobile (desktop/kiosk at facility do not have GPS).
- Matching algorithm (application layer): at check-in time, query ShiftRegistrationEntry for (userId, today, status=approved) -> find entry with shiftTemplate.startTime closest to now() -> set matchStatus, lateMinutes, shiftRegistrationId, shiftTemplateId.
- Check-out records (eventType=check_out) typically do not get matchStatus set -- they are matched by pairing with the nearest preceding check_in for the same user+shift.

---

### 3.7 FacilityNetwork -- Mang/IP duoc phep cham cong

```prisma
/// Danh sach mang/IP duoc phep check-in tai moi facility.
/// Ho tro IP cu the (192.168.1.100) va CIDR range (192.168.1.0/24).
/// Application layer kiem tra IP cua TimeRecord khop voi danh sach nay (advisory, khong chan cung).
model FacilityNetwork {
  id          String    @id @default(uuid()) @db.Uuid
  facilityId  Int       @map("facility_id")
  ipCidr      String    @map("ip_cidr") /// IP cu the hoac CIDR: "192.168.1.100" hoac "192.168.1.0/24"
  label       String?   /// Ten mang: "WiFi Van phong", "LAN tang 1"
  isActive    Boolean   @default(true) @map("is_active")
  archivedAt  DateTime? @map("archived_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@unique([facilityId, ipCidr])
  @@index([facilityId])
  @@map("facility_network")
}
```

**Design notes:**
- ipCidr stores both individual IPs (192.168.1.100) and ranges (192.168.1.0/24) in a single field. Application uses a CIDR parsing library to validate.
- isActive allows temporarily disabling a network without deleting it.
- This is a small, rarely-changing table. No need for updatedAt.

---

## 4. Complete Index Strategy

| Table | Index | Purpose |
|---|---|---|
| shift_group | @@unique([facilityId, code]) | Unique group code per facility |
| shift_group | @@index([facilityId]) | RLS |
| shift_template | @@unique([facilityId, code]) | Unique template code per facility |
| shift_template | @@unique([shiftGroupId, startTime]) | No time overlap within group |
| shift_template | @@index([facilityId]) | RLS |
| shift_template | @@index([shiftGroupId]) | Load all templates for a group |
| shift_registration | @@index([facilityId, userId, status]) | My pending registrations |
| shift_registration | @@index([facilityId, periodStart, periodEnd]) | Manager: registrations in date range |
| shift_registration | @@index([supersededById]) | Trace supersede chain |
| shift_registration_entry | @@unique([registrationId, date, shiftTemplateId]) | No dup within sheet |
| shift_registration_entry | @@index([facilityId]) | RLS |
| shift_registration_entry | @@index([facilityId, date]) | Critical: who works on date X |
| shift_registration_entry | @@index([shiftTemplateId]) | Who registered for shift template X |
| time_record | @@index([facilityId, userId, timestamp]) | Per-user attendance history |
| time_record | @@index([facilityId, timestamp]) | Daily attendance report |
| time_record | @@index([shiftRegistrationId]) | Trace check-ins for a registration |
| time_record | @@index([userId, timestamp]) | Fast user lookup (no facility filter) |
| facility_network | @@unique([facilityId, ipCidr]) | No duplicate IP entries |
| facility_network | @@index([facilityId]) | RLS |

---

## 5. ER Relationships (Conceptual)

```
Facility --< ShiftGroup --< ShiftTemplate
                |                  |
                |                  | (onDelete: Restrict)
                |                  |
AppUser ----< ShiftRegistration >-- ShiftRegistrationEntry >-- ShiftTemplate
  (userId,       |    (supersededById: self-ref)           (date + shiftTemplateId)
  no FK)         |
                 |
                 +----< TimeRecord >-- ShiftTemplate (nullable)
                         (eventType, ip, timestamp, matchStatus)

Facility --< FacilityNetwork (IP whitelist)
```

**Missing relations (intentional):**
- ShiftRegistration.userId -> no FK to AppUser (follows KpiScore/Payslip pattern)
- ShiftRegistration.createdById -> no FK to AppUser
- ShiftRegistration.approvedById -> no FK to AppUser
- TimeRecord.userId -> no FK to AppUser

All user resolution is done at the application/query layer. This keeps AppUser lean and avoids circular dependencies.

---

## 6. Migration Strategy

### 6.1 Approach
All 6 models are net-new tables with no data to migrate from existing tables. A single prisma migrate dev --create-only followed by prisma migrate deploy is sufficient.

### 6.2 Execution
```bash
cd packages/db
pnpm prisma migrate dev --name add_work_shift_registration --create-only
# Review the generated SQL in prisma/migrations/<timestamp>_add_work_shift_registration/
pnpm prisma migrate dev  # apply
```

### 6.3 Seed Data (for development)
After migration, seed script should create:
- 2 ShiftGroup per facility: KINH_DOANH (SINGLE), GIAO_VIEN (MULTIPLE)
- 3 ShiftTemplate per group:
  - KINH_DOANH: Ca sang (08:00-16:00), Ca chieu (12:00-20:00), Ca toi (14:00-22:00)
  - GIAO_VIEN: Ca sang (08:00-12:00), Ca chieu (13:00-17:00), Ca toi (17:30-21:30)
- 1 FacilityNetwork entry per facility: localhost or 0.0.0.0/0 (dev only)

### 6.4 No Complex Migration Needed
- No data transformation from old tables
- No column renaming or type changes
- No backfill scripts needed
- Safe to run during deployment (no downtime)


## 7. Trade-offs and Second-Order Effects

### 7.1 Denormalized facilityId on every table
- Cost: Storage overhead. Slight risk of inconsistency.
- Benefit: RLS queries are WHERE facility_id = $1 without joins.
- Mitigation: Application layer ensures consistency on write.
- Verdict: Follow existing pattern. Accepted cost.

### 7.2 matchStatus stored on TimeRecord (not computed)
- Cost: Stale if shift template times change after check-in (rare).
- Benefit: Payroll computation and dashboard are O(1) reads, not O(n) with date math per row.
- Mitigation: On shift template time change, recalculate matchStatus for affected TimeRecords (background job).
- Verdict: Store at write time. Recalculation is a known operational task.

### 7.3 Self-referential supersededById on ShiftRegistration
- Cost: Deep chains (>10 replacements) cause deep JOINs. Edge case.
- Benefit: Clean audit trail without a separate link table.
- Mitigation: Application limits display to "Superseded by [link]" without walking full chain.
- Verdict: Accepted. Alternative (junction table) adds a table for a rare edge case -- YAGNI.

### 7.4 No periodKey on ShiftRegistration
- Cost: Payroll engine must query by date range to find shifts for a month.
- Benefit: Registrations can span months without complex period logic.
- Verdict: KpiScore/Payslip use periodKey because they are inherently monthly. Shifts are inherently daily.

---

## 8. Validation Checklist

- [ ] Can a KINH DOANH user register 1 shift/day for June 1-30? Yes. 22 ShiftRegistrationEntry rows.
- [ ] Can a GIAO VIEN user register 3 shifts for the same day? Yes. 3 entries with same date, different shiftTemplateId.
- [ ] Can a new shift group be added without migration? Yes. INSERT into ShiftGroup + INSERT into ShiftTemplate.
- [ ] Can an employee check-in without prior registration? Yes. TimeRecord with matchStatus="no_shift".
- [ ] Can we trace "who approved what when"? Yes. approvedById + approvedAt. RecordEvent for full audit.
- [ ] Can we query "who works at facility X on 2026-07-15"? Yes. shift_registration_entry indexed by [facilityId, date].
- [ ] Does RLS work without joining to parent tables? Yes. Every table has facilityId.
- [ ] Can a shift template be deleted if in use? No. onDelete: Restrict. Use archivedAt soft-delete.
- [ ] Can an approved registration be cancelled? Yes. Status -> cancelled with cancelReason. Entries remain.


## 9. Unresolved Questions for User Review

1. **Grace period for "on time"**: What is the acceptable window? 5 minutes before/after shift start? 10 minutes? This affects matchStatus computation logic.

2. **Check-out matching**: Should check-out be manually paired to a check-in, or auto-matched to the nearest check-in for the same user+shift?

3. **Overtime tracking**: The current design records check-in/out but does not distinguish registered shift hours from overtime hours. Is overtime computed as (checkout - checkin) - registered_shift_duration? Does TimeRecord need an is_overtime flag?

4. **Shift swapping**: Can two employees swap shifts after registration? If so, how is this tracked? This is a Phase 2 concern but worth noting now.

5. **Holiday/leave integration**: Is leave management a separate module that reduces expected shift count, or should ShiftRegistrationEntry carry a leaveType field?

6. **Check-in method**: Is check-in via web browser, mobile app, or both? This affects the authentication flow (session vs JWT vs device token).

7. **Concurrent check-ins**: Can an employee be checked into two shifts simultaneously? The system should prevent overlapping clock-ins for the same user.

---

## 10. Simplest Viable Option Summary

| Component | Simplest approach taken |
|---|---|
| Shift catalog | 2 tables: ShiftGroup + ShiftTemplate. No JSONB, no enum. |
| Registration model | Sheet header + flat entries (not 3-level hierarchy). |
| Check-in/out | One table with eventType discriminator. Nullable shift mapping. |
| IP restriction | One simple table. Advisory, not blocking. |
| Workflow status | 4 states (draft/submitted/approved/cancelled). No confirmed step. |
| Supersede tracking | Self-referential FK. No junction table. |
| Audit | Reuses existing RecordEvent. No new audit model. |
| User relations | No FKs to AppUser (follows KpiScore/Payslip pattern). |

**Total new models:** 6
**Total new enums:** 2
**Lines of Prisma schema added:** ~120
**Migration complexity:** Trivial (net-new tables only)

---

*Report produced by Agent 02 (Brainstormer). Awaiting user review before proceeding to implementation.*
