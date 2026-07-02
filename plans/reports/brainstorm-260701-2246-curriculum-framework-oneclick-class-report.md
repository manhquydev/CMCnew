# Brainstorm — Khung chương trình (hard-code) + Luồng 1-click tạo lớp + Log vận hành + Quan hệ LMS

- **Ngày:** 2026-07-01 22:46 (ICT)
- **Nhánh:** develop
- **Chế độ:** brainstorm (không implement) — chờ duyệt trước khi `/ck:plan`
- **Nguồn dữ liệu khung:** `D:\Downloads\curriculum_units_seed.csv` (60 unit: UCREA L1/L2/L3, Bright I.G J/T/C/W/Q/U)

---

## 1. Vấn đề & Yêu cầu (đã chốt với user)

1. Tiếp nhận CSV khung chương trình → đưa vào codebase để tham chiếu.
2. **Khóa cứng** khung chương trình → tạo lớp mới **1-click** (curriculum không sửa được khi tạo lớp).
3. Sau 1-click, cấu hình tham số lớp: **thứ trong tuần, giờ bắt đầu/kết thúc, GV, phòng, ngày khai giảng, sĩ số**.
4. **Log riêng cho mỗi lớp** (timeline) giám sát mọi thay đổi vận hành: đổi giờ, đổi thứ, đổi giáo viên, đổi trạng thái…
5. Xác định rõ **trường khóa cứng vs trường cấu hình**, và **quan hệ thể hiện ở LMS**.
6. Mọi thay đổi phải **đồng bộ, nhất quán phủ toàn hệ thống**.

### Quyết định user đã chốt
| Chủ đề | Chọn |
|---|---|
| Mô hình data | **A1 — Bảng DB `CurriculumUnit`** (không dùng file tĩnh) |
| Luồng 1-click | **B1 — Tạo vỏ → cấu hình → sinh buổi** |
| Quan hệ LMS | **C1 — Nối unit vào từng `ClassSession`** |
| Phạm vi vòng này | **Cả 4 mảng** (data+seed / 1-click+multi-slot / edit+log / UI log + LMS) |
| Map `sessions` | **1 unit = N buổi thật** (bung ra theo `order_global`) |
| Trường khóa cứng/cấu hình | **Đúng đề xuất** (bảng §4) |

---

## 2. Hiện trạng codebase (scout)

**Nền tảng đã có — tận dụng, không xây lại:**
- **Audit/Chatter đầy đủ:** `RecordEvent` + `RecordFollower`; `@cmc/audit` (`logEvent`, `logStatusChange`, `diffChanges`, `addFollower`, `getTimeline`); router `audit.timeline` với allow-list `NOTE_TARGETS` **đã có `class_batch`**. UI `packages/ui/src/activity-log.tsx` dùng ở student/schedule/staff.
- **Mô hình lớp:** `Course`(program+level, global) → `ClassBatch`(theo cơ sở) → `ScheduleSlot`(khung tuần) → `ClassSession`(buổi thật). `Enrollment`/`Attendance`/`Exercise`/`SessionEvidence`(LMS)/`LevelProgress`.
- **Luồng tạo/sinh buổi:** `classBatch.create` (1 `initialSlot`) → `schedule.addSlot` → `schedule.generateSessions` (idempotent, chặn trùng phòng/GV). Tạo/hủy/mở lại/thêm slot/sinh buổi **đều đã log**.

**Khoảng trống cần lấp:**
| # | Thiếu | Ảnh hưởng yêu cầu |
|---|---|---|
| G1 | Không có model/dữ liệu khung chương trình (`CurriculumUnit`) | Khóa cứng + 1-click + LMS chi tiết |
| G2 | Không có `schedule.editSlot` / `removeSlot` | "đổi giờ/đổi thứ/đổi GV" ở khung tuần |
| G3 | Không có `classBatch.update` (tên/ngày/capacity) có diff-log | Sửa lớp + log |
| G4 | `create` chỉ nhận 1 thứ | "nhiều thứ trong tuần" |
| G5 | `ClassSession` chưa liên kết unit | Quan hệ LMS theo buổi |
| G6 | `class-workspace.tsx` chưa gắn timeline | "log riêng của lớp" hiển thị |
| G7 | Program CSV `"Bright I.G"` ≠ enum `BRIGHT_IG` | Seed cần map |

---

## 3. Cấu trúc CSV (60 unit)

`unit_code, program, level_code, seq_in_level, unit_type(LESSON/REVIEW), assessment, chu_de, noi_dung, tu_duy_dat_duoc, sessions, duration_month, order_global`

- **UCREA:** L1/L2/L3 — mỗi level 12 unit (10 LESSON + MID + FIN), `sessions=4` ⇒ 48 buổi/level.
- **Bright I.G:** J/T/C/W/Q/U — mỗi level 4 unit (3 LESSON + 1 REVIEW "thi lên level"), `sessions=4` ⇒ 16 buổi/level.
- Enum `Program` hiện có `BLACK_HOLE` **không có** dữ liệu khung → `units` để rỗng (hợp lệ).

---

## 4. Trường KHÓA CỨNG vs CẤU HÌNH (đã xác nhận)

| Nhóm | Trường | Nguồn |
|---|---|---|
| 🔒 **Khóa cứng** | program, level, danh sách unit + thứ tự (`order_global`), số buổi/unit (`sessions`), loại buổi (LESSON/REVIEW), điểm kiểm tra (`assessment`), chủ đề/nội dung/sách/play-kit/tư duy | `CurriculumUnit` (seed từ CSV) |
| ⚙️ **Cấu hình theo lớp** | cơ sở, tên lớp, ngày khai giảng, các thứ/tuần + giờ bắt đầu/kết thúc, giáo viên, phòng, sĩ số | Nhập khi tạo/sửa lớp |

---

## 5. Giải pháp đề xuất (kiến trúc)

### 5.1 Data model (Prisma — additive, migration an toàn)

```
model CurriculumUnit {           // global, giống Course (facility_id null)
  id, courseId(FK Course),
  unitCode @unique,              // UC-L1-01
  seqInLevel, orderGlobal,
  unitType(enum UnitType: LESSON|REVIEW),
  assessment?, theme, content?, thinkingGoal?,
  sessions Int, durationMonth?,
  archivedAt?
}
Course  += levelCode? , units CurriculumUnit[]
ClassSession += curriculumUnitId?  (FK CurriculumUnit, onDelete SetNull; null cho buổi bù / lớp không theo khung)
```
- `Course` seed 1 dòng/(program+level): UCREA-L1/L2/L3, BRIGHT_IG-J/T/C/W/Q/U (upsert theo `code`, tránh trùng course UCREA đã seed ở `seed.ts:154`).

### 5.2 Sinh buổi map unit (xương sống)
1. Bung units của course theo `order_global` → danh sách phẳng độ dài `Σ sessions` (mỗi unit lặp `sessions` lần).
2. Liệt kê ngày thật từ các `ScheduleSlot` trong `[startDate, endDate]` (dùng `enumerateSessions` sẵn có), sắp theo thời gian.
3. **Zip**: buổi thứ `i` ⇐ unit thứ `i`. Gán `curriculumUnitId`.
4. Idempotent: gán deterministic theo thứ tự ngày → re-run không lệch.
5. Cảnh báo khi: ngày < curriculum (chưa xếp hết unit) hoặc ngày > curriculum (buổi dư → `curriculumUnitId=null`). Log rõ.

### 5.3 API (tRPC)
- `curriculum.list` / `curriculum.listByCourse` — đọc unit (read: mọi staff; write: super/curriculum-admin qua permission mới).
- `classBatch.create` — mở rộng nhận `slots: Slot[]` (nhiều thứ), giữ tương thích `initialSlot`. Course khóa cứng.
- `classBatch.update` — tên/ngày/capacity + `diffChanges` → `logEvent(type:'updated', changes)`.
- `schedule.editSlot` — đổi thứ/giờ/phòng/GV; log body "Đổi khung: thứ A→B, giờ …". **Quyết định cascade (mục §7-R1).**
- `schedule.removeSlot` — soft-archive (`archivedAt`) + log.
- `schedule.generateSessions` — bổ sung gán `curriculumUnitId` (§5.2).

### 5.4 UI
- **Modal tạo lớp** (`class-workspace.tsx`): chọn program → level → course; preview khung khóa cứng (số unit/buổi); nhập tên + ngày KG + **nhiều thứ + giờ** + GV + phòng + sĩ số → 1-click.
- **Màn chi tiết lớp:** gắn `activity-log.tsx` (timeline `entityType='class_batch'`); bảng slot thêm nút Sửa/Xóa.
- **LMS:** view buổi hiển thị chủ đề/nội dung/sách/play-kit/assessment theo `curriculumUnit`.

### 5.5 Vị trí CSV trong codebase
- `packages/db/prisma/seed-data/curriculum_units_seed.csv` (nguồn seed) + importer `seed-curriculum.ts` (map `"Bright I.G"→BRIGHT_IG`), thêm script `pnpm --filter @cmc/db seed:curriculum`.

---

## 6. Đồng bộ nhất quán toàn hệ thống (yêu cầu #6)

| Thay đổi | Lan tỏa cần đảm bảo |
|---|---|
| Sửa slot (thứ/giờ/GV) | Template + (tùy chọn) buổi tương lai chưa hủy; log; kiểm tra trùng phòng/GV (`detectConflicts`) |
| Xóa slot | Soft-archive; không xóa buổi đã sinh (giữ audit); log |
| Đổi trạng thái/hủy lớp | Đã có cascade buổi + họp PH + notify GĐĐT (giữ nguyên) |
| Sinh lại buổi | Idempotent theo (ngày, giờ); gán unit deterministic |
| Seed lại curriculum | Upsert theo `unitCode`/`code`; không nhân bản |

---

## 7. Rủi ro & điểm mở cho `/ck:plan`

- **R1 (cascade editSlot):** đổi slot của lớp **đang chạy** → chỉ đổi template hay đổi luôn buổi tương lai? *Đề xuất:* editSlot đổi template + tùy chọn "áp dụng cho buổi tương lai" (update `ClassSession` chưa qua/chưa hủy), có kiểm tra trùng + log. Chốt ở plan.
- **R2 (edit cấp buổi):** đổi GV/giờ **một buổi lẻ** — ngoài phạm vi cốt lõi; có thể thêm `schedule.editSession` sau. Xác nhận ở plan.
- **R3 (RLS/permission):** `CurriculumUnit` global (facility_id null) đọc bởi mọi staff (như Course); write cần permission `curriculum:manage` mới trong registry.
- **R4 (Program enum):** map seed; `BLACK_HOLE` không có khung (units rỗng — hợp lệ).
- **R5 (migration):** thuần additive (thêm bảng + cột nullable) → an toàn, không phá dữ liệu hiện có.
- **R6 (intake/lane):** chạm data-model + public API (tRPC) + LMS đa domain ⇒ **high-risk lane** theo `docs/FEATURE_INTAKE.md` (Data model + Public contracts + Multi-domain). Cần story folder high-risk + có thể 1 decision record.

---

## 8. Tiêu chí nghiệm thu (acceptance)

1. Chọn khung chương trình → 1 click tạo lớp vỏ; curriculum khóa cứng (UI không cho sửa unit).
2. Nhập ≥2 thứ/tuần + giờ + GV + phòng + ngày KG → sinh buổi; mỗi buổi có `curriculumUnitId` đúng thứ tự.
3. LMS hiển thị chủ đề/nội dung/sách/play-kit/assessment theo từng buổi.
4. `editSlot`/`removeSlot`/`classBatch.update` ghi timeline đầy đủ (field old→new / body mô tả).
5. Màn chi tiết lớp hiển thị **timeline log riêng** của lớp.
6. Seed đủ: UCREA L1-3 + Bright J/T/C/W/Q/U; đúng số unit/buổi từ CSV; re-run không nhân bản.
7. Kiểm tra trùng phòng/GV vẫn hoạt động sau khi map unit.

---

## 9. Phạm vi (in/out)

**IN (vòng này):** model CurriculumUnit + seed CSV; Course levelCode + seed courses; ClassSession.curriculumUnitId; multi-slot create + 1-click UI; editSlot/removeSlot/classBatch.update + log; timeline UI trên màn lớp; LMS hiển thị curriculum theo buổi.

**OUT (để sau):** edit cấp buổi lẻ (R2); trình soạn/CRUD curriculum qua UI (chỉ seed + read vòng này); tự động lên lịch thi/điểm từ unit REVIEW; đồng bộ certificate/level-up theo unit.

---

## 10. Câu hỏi còn mở (chốt khi vào plan)
1. R1 — editSlot có cascade buổi tương lai không (mặc định đề xuất: có, tùy chọn)?
2. R2 — cần edit cấp buổi lẻ trong vòng này không (đề xuất: không)?
3. Curriculum write có cần UI quản trị vòng này, hay chỉ seed + read (đề xuất: chỉ seed + read)?
