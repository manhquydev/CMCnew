# Teacher Lite — Sổ đăng ký thiếu sót (Audit-first)

> Ngày: 2026-07-08 · Nguồn: 4 audit agent song song (audit-log wiring, director cancel/close,
> student/PH CRUD, prototype parity) trên `develop`/prod `60913b3` · Trạng thái: brainstorm discovery.

## 0. Kết luận đầu tiên (đọc trước)

**Hệ thống teacher-lite KHÔNG "sơ sài" — nó đã ~80% hoàn thiện.** Phần lớn khiếu nại là do
**chưa surface / reachability hẹp / vài mutation thiếu**, KHÔNG phải thiếu tính năng lõi. Cụ thể:

| Khiếu nại của bạn | Thực tế (bằng chứng) |
|---|---|
| `/overview` chưa hoạt động | Panel render OK; chỉ 2 stat "Bài chờ chấm"/"Nhận xét chờ chốt" hardcode "—" (`teacher-today-panel.tsx:148-160`) |
| Quản lý HS/PH sơ sài, chưa sửa/xóa | Student **edit ĐÃ CÓ** (`students-panel.tsx` "Sửa" → `student.update`); **thiếu** delete + parent-edit + parent-delete |
| Chưa có log | Audit **ĐÃ GHI** đầy đủ (`logEvent` ở attendance/grade/evidence/student/guardian) — chỉ **chưa xem được** (read-side gap) |
| GV chưa log "ai điểm danh lúc nào" | `attendance.mark` **CÓ** ghi actor+status+time vào `RecordEvent` (`attendance.ts:111`) — chỉ thiếu whitelist + UI |
| Giám đốc chưa cancel buổi/lớp | **ĐÃ CÓ ĐỦ**: `teacherLite.cancelClass`/`cancelSession` + UI `teacher-lite-class-control-panel.tsx` + audit |
| Giao diện lệch prototype | Vòng lặp dạy của GV **MATCHES**; đa số "thiếu" là scope-cut cố ý (dùng "Mở ERP đầy đủ") |

→ **Hệ quả chiến lược:** "xây lại từ đầu / hệ thống riêng biệt" sẽ **vứt bỏ code đang chạy tốt**. Việc
đúng là **đóng gap + đơn giản hóa UX trên surface hiện có**, KHÔNG rebuild. Chi tiết ở §4.

## 1. Deficiency register (ưu tiên theo severity)

### P0 — chặn yêu cầu cốt lõi "log hết + GV/HS nghiệp vụ"
| ID | Thiếu sót | Scope | Fix | Bằng chứng |
|---|---|---|---|---|
| AUD-1 | Điểm danh ghi log nhưng **không đọc được** (`class_session` không trong `NOTE_TARGETS`) | backend-whitelist | thêm `class_session` vào NOTE_TARGETS (resolver facilityId từ session) | `audit.ts:12-24`, `attendance.ts:111` |
| AUD-2 | Session-detail teacher-lite **không có UI timeline** | UI | gắn `<Chatter entityType="class_session">` vào `teacher-schedule-session-detail.tsx` | grep = no Chatter |

### P1 — nghiệp vụ quản lý còn khuyết
| ID | Thiếu sót | Scope | Fix | Bằng chứng |
|---|---|---|---|---|
| CRUD-1 | Student **không có delete/archive** | backend+UI | thêm `student.archive` (soft, set `archivedAt`) + nút | `student.ts` (no delete) |
| CRUD-2 | Parent **staff-edit không có** (chỉ parent tự sửa) | backend+UI | thêm `guardian.parentUpdate` [KD,DT] + modal | `guardian.ts:130` self-only |
| CRUD-4 | `parentCreate` **không audit** | audit-wiring | thêm `logEvent(parent_account, created)` | `guardian.ts:45-60` |
| AUD-3 | Grade events orphaned (không đọc được) | whitelist+UI | fold vào timeline `student` hoặc whitelist `grade` | `grade.ts:97` |
| AUD-4 | Session-evidence events orphaned | whitelist+UI | whitelist `class_session`/`session_evidence` | `session-evidence.ts:195` |
| PAR-1 | **KPI approval dead-end**: cockpit → `/kpi` → redirect loop (kpi không trong Set) | UI+nav | thêm `kpi` vào `TEACHER_SURFACE_SECTIONS` | `App.tsx:754`, `app-surface.ts:11-32` |
| A-1 | `/overview` 2 stat hardcode "—" ("Bài chờ chấm", "Nhận xét chờ chốt") | UI-query | query số thật | `teacher-today-panel.tsx:148-160` |

### P2 — hoàn thiện / UX / phân quyền
| ID | Thiếu sót | Scope | Fix |
|---|---|---|---|
| CRUD-3 | Parent delete/archive không có | backend+UI | `guardian.parentArchive` (soft) sau khi check hết link |
| CRUD-5 | GĐĐT không sửa được student (nav ẩn + gate `[sale,KD]`) | permission | product call: thêm `giam_doc_dao_tao` vào `student.update`? |
| CRUD-8 | Không có timeline UI cho parent record | UI | parent-detail + `<Chatter entityType="parent_account">` |
| AUD-5 | Guardian events orphaned | whitelist | fold vào timeline `student` |
| DIR-5 | Cancel lớp/buổi **không có modal xác nhận** (chỉ cần nhập lý do) | UI | bọc `openConfirmModal` show cascade count |
| DIR-6 | Panel cancel gate bằng `createClass` thay vì `cancelClass` | UI | tách gate (harmless hiện tại) |
| PAR-3 | GĐKD land ở `family-intake` thay vì cockpit (cổng tiền) | UI | land GĐKD ở `biz-director-cockpit` |
| B-1 | Director HR trên teacher-lite: hr/kpi/payroll không trong Set | nav-scope | quyết định expose hay giữ ERP-only |

### Đã hoàn chỉnh (KHÔNG cần làm — để tránh làm lại)
- **G (director cancel/close):** `teacherLite.cancelClass`/`cancelSession` — backend+UI+quyền 2 giám đốc+audit ĐỦ.
- **GV teaching loop:** điểm danh/ảnh+nhận xét/chấm bài/nhật ký — 4 tab session-detail MATCHES prototype.
- **Student edit + timeline:** `student.update` + History tab `<Chatter entityType="student">` (`student-detail.tsx:572`).
- **Tạo lớp + upload học liệu:** `classBatch.create` + `CourseExerciseManager` (`courses-panel.tsx:113`).
- **Audit write path:** mọi mutation lõi ĐÃ gọi `logEvent` đúng (actor + facilityId server-derived).

## 2. Chưa verify được (cần test live — bị chặn vì cần login role tương ứng)
- **F1 — HS làm bài + nộp bài (LMS app `apps/lms`):** chưa xác minh UI HS xem file bài tập → làm → nộp về GV. Cần login student trên `hoc.cmcvn.edu.vn`.
- **F2 — Upload học liệu theo buổi:** `CourseExerciseManager` có, nhưng gắn tài liệu **đúng buổi/bài** cho LMS chưa verify E2E.
- **F3 — Chấm bài trả SAO:** user muốn "trả sao"; `grade.grade` hiện `{score, feedback}` **không có stars** → **gap thật** nếu cần rating sao.
- **PAR-2:** `TeacherLiteIntakePanel` (tạo LMS-student thủ công) — đã có backing decision 0039 (direct provisioning). Không phải divergence.

## 3. Hạ tầng dùng lại (cho builder — không cần khám phá lại)
- **Audit:** model `RecordEvent` (`tx.recordEvent`), `RecordFollower`. `logEvent(tx,{facilityId?,entityType,entityId,type:'created'|'updated'|'status_changed'|'archived'|'restored'|'note',changes?,body?,actorId?})` — gọi trong cùng `withRls` tx. Read gate = `NOTE_TARGETS` (`audit.ts:12-24`). UI = `<Chatter>` (`packages/ui/src/chatter.tsx`).
- **Director control:** `teacherLite.cancelClass({id,reason})`, `teacherLite.cancelSession({sessionId,reason})`, `teacherLite.createClass({...})`. Quyền `[giam_doc_kinh_doanh, giam_doc_dao_tao]`.
- **CRUD sẵn:** `student.update({id,fullName?,dateOfBirth?})`; `guardian.unlink({id})`. Thiếu: student.archive, guardian.parentUpdate, guardian.parentArchive.

## 4-BIS. QUYẾT ĐỊNH ĐÃ CHỐT (2026-07-08)

**Phương án A** (giữ Decision 0039 — không DB/app riêng). Kèm mandate đơn giản hóa:
- **Lược bỏ khỏi teacher-lite:** sale, KPI, chấm công (checkin/shift), finance, CRM, cskh, rewards,
  badges, revenue-report, reconcile, compensation, payroll-checkin, my-payslips, org, facility-network,
  shift-config. → teacher-lite chỉ còn: dạy học (GV) + quản lý lớp/HS/PH/nhân sự-gọn (giám đốc) + LMS.
- **Giám đốc quản lý nhân sự (đội giáo viên) BẢN GỌN** trong teacher-lite: xem/thêm/sửa GV, phân công —
  KHÔNG payroll/KPI/chấm công.
- **Ưu tiên #1 = luồng LMS cho PH + HS** (HS thấy bài → làm → nộp; PH nghiệp vụ tương ứng).
- **Chấm bài KHÔNG trả sao** (bỏ F3; giữ score + feedback).
- **PAR-1 đảo hướng:** KPI **gỡ khỏi cockpit** (không thêm vào Set) — vì KPI bị lược bỏ.
- **Verify live prod:** test luồng **học viên thật** (được phép); PH tự làm OTP email.
- Gấp: hoàn thiện + kiểm chứng thật.

## 4. Quyết định kiến trúc (GATE — đã chốt A ở §4-BIS)

Định hướng bạn nêu: *"xây lại giao diện… clear toàn bộ rule chặt… tạo 1 hệ thống riêng biệt liên kết LMS"*.
**Va chạm Decision 0039** ("KHÔNG tạo DB/sync/LMS riêng; giữ API/DB/RLS/auth"). Hai lối:

**Phương án A — Đóng gap + đơn giản hóa UX trên surface hiện có (giữ 0039, KHUYẾN NGHỊ)**
- Surface audit (P0), thêm CRUD thiếu (P1), fix KPI routing, hoàn thiện overview, **nới rule/nav nặng** cho gọn, pass UX simplify. Giữ chung DB+auth+LMS.
- Ưu: tận dụng ~80% code đang chạy, rủi ro thấp, nhanh, không nợ đồng bộ. "Hệ thống riêng biệt" của bạn **thực chất đã tồn tại** = surface `teacher` riêng, chỉ cần gọn hơn.
- Nhược: vẫn nằm trong codebase admin (không phải app riêng).

**Phương án B — Rebuild app/hệ thống riêng biệt (bội 0039)**
- App/DB riêng, chỉ sync sang LMS. Ưu: sạch tuyệt đối. Nhược: **vứt code đang chạy**, data-fork risk (0039 đã bác chính phương án này), chậm, phải viết lại auth/RLS/provisioning.
- Nếu chọn B → cần **decision doc mới supersede 0039** trước khi code.

**Khuyến nghị: A.** Nó thỏa 100% ý định "đơn giản, riêng, liên kết LMS" mà không phá 0039 hay bỏ code.

## 5. Trình tự build (đã chốt A — feed vào ck:plan)
1. **Phase 1 — Đơn giản hóa nav teacher-lite (P0 UX):** lược bỏ sale/KPI/chấm công/finance/CRM/... khỏi
   `TEACHER_SURFACE_SECTIONS` + gỡ KPI item khỏi cockpit (PAR-1). Nav gọn cho 3 vai trò.
2. **Phase 2 — Luồng LMS PH+HS (ƯU TIÊN #1, verify live trước):** HS thấy file bài tập → làm → nộp về GV;
   upload học liệu theo buổi; PH view. Test live tài khoản HS thật trên prod.
3. **Phase 3 — Audit surfacing (P0 "log hết"):** whitelist `class_session` + `<Chatter>` panel session-detail;
   fold grade/session_evidence/guardian vào timeline đọc được.
4. **Phase 4 — CRUD hoàn thiện (P1):** student.archive, guardian.parentUpdate/parentArchive, parentCreate audit;
   widen reachability HS/PH cho đúng vai trò.
5. **Phase 5 — Giám đốc quản lý nhân sự gọn + overview + cancel confirm:** staff-mgmt bản gọn (xem/thêm/sửa GV,
   phân công); overview stat thật; modal xác nhận cancel lớp/buổi.

## Unresolved questions
1. **A hay B?** (gate — §4). Nếu B cần decision doc mới.
2. **Trả sao (F3):** có cần rating sao thật không, hay điểm số + feedback là đủ?
3. **CRUD-5:** GĐĐT có cần sửa student không (hiện chỉ sale+KD)?
4. **F1/F2:** cần bạn login student/director để tôi test live luồng LMS làm-nộp bài + upload học liệu theo buổi.
