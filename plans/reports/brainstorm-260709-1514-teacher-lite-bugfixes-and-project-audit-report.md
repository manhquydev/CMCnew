# Brainstorm — Teacher-lite 4 bugfixes + full-project bug hunt

- **Date:** 2026-07-09
- **Context:** clear-ERP teacher-lite ([[clear-erp-teacher-lite-only]]); after 2-role restructure shipped ([[teacher-lite-2role-restructure-shipped]])

## Confirmed root causes (scouted)

### Bug 1 — Tạo lớp vẫn bắt điền ngày kết thúc (/family-intake)
- Backend `createTeacherLiteClassInput.endDate` = optional, NHƯNG `generateInitialSessions`
  (teacher-lite-class-workflows.ts:97) cần endDate → `enumerateSessions(slots, startDate, endDate)`
  là **range-based**. Không auto-derive từ curriculum.
- Auto-estimate endDate chỉ có ở class-workspace.tsx (ERP), chưa port. UI teacher-lite ép `!endDate`
  (teacher-lite-class-control-panel.tsx:128).
- **Decision (user):** server-truth — backend sinh ĐÚNG `totalSessions` của curriculum từ ngày bắt đầu
  + slot; **bỏ hẳn field endDate** khỏi UI teacher-lite. Đổi generation sang count-based.

### Bug 2 — Auto-course chọn Bright thay vì UCREA L1 (SORT bug, verified data OK)
- teacher-lite-class-control-panel.tsx:117 `sort((a,b)=>a.code.localeCompare(b.code))[0]` = alphabet.
  "BRIGHT_IG-C" < "UCREA-L1" → Bright thắng.
- Prod data (verified): UCREA-L1 = 12 unit, BRIGHT_IG-* = 4 unit each. UCREA L1 CÓ content — chỉ thua sort.
- **Fix:** order theo ưu tiên program (UCREA → BRIGHT_IG → BLACK_HOLE) rồi levelCode (L1<L2<L3), pick
  first-with-units. → UCREA-L1. (class-workspace.tsx cũng dùng cùng sort sai → sửa cả 2 chỗ / helper chung.)

### Bug 3 — Mã dự phòng HQ-HS-2026-0001 "không tồn tại"
- Backend CÓ `loginStudent(loginCode, password)` (lms-auth.ts:44); `loginCode = facility.code + '-' + studentCode`.
- Nghi vấn: UI LMS chỉ có ô SĐT phụ huynh (`loginFamilyByPhone`), không có ô nhập mã → mã hiển thị vô dụng.
- **Decision (user):** SĐT phụ huynh là chính (decision 0033) + **bỏ hiển thị 'mã dự phòng'** khỏi UI intake
  (teacher-lite-intake-panel.tsx) cho đỡ nhầm. Không thêm ô nhập mã. Giữ backend loginStudent nguyên (không xóa).

### Feature 4 — /courses xem được file học liệu hiện tại
- course-exercise-manager.tsx:247 chỉ có TextInput "PDF ref hiện tại" (hash sha256), không render.
- **Fix:** thêm PDF preview (tái dùng viewer chấm bài đã có ở session-detail / LMS annotator) để thấy nội dung file.

## Full-project bug hunt (report-only, multi-agent)

- **Mode (user):** report-only. Agent theo domain quét + báo bug (KHÔNG sửa). Tôi consolidate → triage →
  fix cái xác nhận; high-risk hỏi user.
- **Domains (mỗi agent 1 report vào plan reports/):**
  1. Auth & session (staff login, LMS login, tokenVersion, RLS context, anti-escalation)
  2. Class / curriculum / scheduling (createClass, generateSessions, curriculum mapping, session lifecycle)
  3. LMS homework (exercise, submission, grading, exercise-open gating)
  4. Attendance / evidence / comment (mark/markAll gate, session-evidence, publish-to-lms)
  5. Provisioning / enrollment (family-student, enroll dedup, lifecycle, receipt→provision)
  6. Nav / RBAC / surface (permissions registry, teacher-lite nav, direct-URL reachability)
  7. Data integrity / migrations (schema drift, unique constraints, orphan rows, seed consistency)
- Each agent: scout + reason about latent bugs, output `reports/audit-<domain>-report.md` with
  severity-ranked findings (file:line, failure scenario, repro). NO code changes.

## Scope boundary (OUT)
- Không đổi DB role/RBAC model. Không xóa loginStudent backend. Không đụng LMS làm-bài flow.
- Bug hunt = discovery only; fixes triaged separately (high-risk → user).

## Governance
- Decision 0039/0040 (teacher-lite API bypass giữ RLS+audit+anti-escalation), 0033 (family-by-phone login).
- Server-truth cho session generation.

## Unresolved
- loginStudent runtime: verify 1 mã thật trên prod có login được không (informational — quyết đã chốt bỏ hiển thị).
