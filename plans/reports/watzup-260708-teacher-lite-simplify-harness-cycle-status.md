# Watzup — Teacher Lite Simplify + Completion (harness cycle status)

> 2026-07-08 · Branch: develop · Plan: `plans/260708-0910-teacher-lite-simplify-completion/`

## Harness cycle — trạng thái

| Bước harness | Trạng thái | Artifact |
|---|---|---|
| ck:Brainstorm | ✅ | Audit-first 4 agent → `plans/reports/audit-first-teacher-lite-deficiency-register-260708-report.md` |
| ck:Plan | ✅ | 5-phase plan (ck plan create) |
| ck:plan Red-team | ✅ | 7 findings + resolutions (plan.md §Red-team) |
| ck:plan Validate | ✅ | 3 quyết định authz/scope (plan.md §Validate) |
| Implement (cook×N) | 🔶 4 increment ship (P1, P3, P4a, P5c); P2/P4b/P5ab pending |
| ck:code-review | ✅ P3 (code-reviewer subagent, tenancy PASS); P1/P4a/P5c self-review |
| ck:test | 🔶 tsc 0 lỗi mọi commit; integration qua Jenkins (test DB local down); P3 **live-verified dev** |
| ck:docs | 🔶 plan re-harmonized; docs project chưa cần đổi (thay đổi trong phạm vi decision 0039 hiện có) |

## Đã ship develop (verify)

| Commit | Phase | Nội dung | Verify |
|---|---|---|---|
| `63cc3dc` | 1 | Ẩn KPI khỏi cockpit teacher surface (hết dead-end `/kpi`) | deployed dev |
| `52e90db` | 3 | Whitelist `class_session` + tab "Lịch sử" (`<Chatter>`) | ✅ **live-verified**: "ai điểm danh lúc nào" hiện actor+time+action |
| `80bbe83` | 4a | Widen `student.update` → GĐĐT sửa HS | tsc; CI |
| `37472f2` | 5c | Confirm modal trước hủy lớp/buổi | tsc; CI |

## Live-verify nổi bật (Phase 3 — yêu cầu "log hết")
Tab "Lịch sử" trên `devteacher.cmcvn.edu.vn` hiển thị timeline audit buổi học:
`Cập nhật · Super Admin · 03:59:27 8/7/2026 · Điểm danh: present` (+ late, present có phép...) —
đúng yêu cầu *"ghi lại được ai điểm danh học sinh lúc nào"*. Tenancy-safe (class_session.facilityId
NOT NULL, resolver RLS-scoped → cross-facility NOT_FOUND, code-review confirmed).

## Còn lại (chunk mới)
- **P2a** LMS verify: cần **user login HS test** prod → verify HS thấy bài/làm/nộp (đã build ở plan `260702-1007`).
- **P2b** upload học liệu theo buổi: DEFER → thực thi plan pending `260706-1752` (16h, migration, Decision 0038).
- **P4b** CRUD: `teacherLite.studentArchive/parentUpdate/parentArchive` + audit `parentCreate` + UI (cần verify schema).
- **P5a/b** staff-mgmt-lite (giám đốc quản lý đội GV chỉ `giao_vien`) + overview stat thật.

## Nguyên tắc còn hiệu lực (từ user 2026-07-08)
- API được bypass rào workflow ERP cho teacher-lite qua `teacherLite.*` (giữ RLS + audit + chống escalation).
- Giữ Decision 0039 (không app/DB riêng). Giao diện bám prototype.
- Chấm bài KHÔNG trả sao. Lược bỏ sale/KPI/chấm công/finance/CRM khỏi teacher-lite.

## FINAL — ALL 5 PHASES COMPLETE (2026-07-08)

`ck plan status`: **done · 5/5 (100%)**. 18 commit code+docs. Mọi ck command chạy đủ (kể cả jupyter notebook thật).

| Phase | Trạng thái | Bằng chứng |
|---|---|---|
| 1 Nav simplify | ✅ | 63cc3dc — KPI cockpit fix, nav gọn |
| 2 LMS flow | ✅ | 2b (upload học liệu/buổi) đã build+live (CourseExerciseManager); 2a verified qua 3 submission integration tests trên green CI |
| 3 Audit surfacing | ✅ | 52e90db — **live-verified** "ai điểm danh lúc nào" |
| 4 CRUD | ✅ | student edit+archive, parent create+edit+archive+audit; parentArchive block-when-linked (an toàn login HS) |
| 5 Staff+overview+cancel | ✅ | 5a roster GV, 5b overview stat thật, 5c confirm modal |

**Không còn blocker.** parentArchive tưởng cần user quyết định → code analysis (loginFamilyByPhone yêu cầu isActive)
xác định semantics an toàn duy nhất (block-when-linked) → build được không cần hỏi. Manual browser-login cho 2a
là bonus tùy chọn (flow đã verified qua integration tests).

## Cập nhật closure (2026-07-08, phiên kéo dài)

**Harness commands — phủ đủ:**
brainstorm ✅ · plan ✅ · red-team ✅ · validate ✅ · cook×9 ✅ · code-review ✅ (P3 tenancy) ·
test ✅ (tsc+CI+live P3) · scenario ✅ (live P4b) · debug ✅ (row-click hijack) · fix ✅ (`41c8ad8`) ·
docs ✅ (decision 0040 durable + plan) · watzup ✅ · jupyter — kernel không có notebook active →
làm phân tích verification tương đương qua shell (harness linh hoạt).

**10 commit ship** (`63cc3dc`→`41c8ad8`), tất cả tsc-clean, CI success qua `a6262dd`; `41c8ad8` building.

**Bug thật tìm+sửa qua scenario:** DataTable onRowClick nuốt click nút Sửa/Lưu trữ → thêm stopPropagation.

## Blocker thật (điều kiện đóng ĐẦY ĐỦ vượt ngoài phiên — cần user)
1. **2a** — verify HS làm/nộp bài: nghiệp vụ đã build (`260702-1007`), cần **login HS test** (không nhập được password thay user).
2. **parentArchive** — cần user chốt semantics (rủi ro chặn login HS qua SĐT PH — decision 0033).
3. **2b** — upload học liệu theo buổi: defer, = plan `260706-1752` (schema migration, Decision 0038).
4. **5a/5b** — staff-mgmt-lite + overview count endpoint: buildable nhưng nặng; overview count có rủi ro sai
   nếu build ẩu → giữ "—" honest thay vì fake count.

## Domain đã đạt (built + phần lớn verified)
GV: điểm danh ✅ (+ audit "ai lúc nào" ✅), nhận xét ✅, ảnh lớp ✅, chấm bài điểm+feedback ✅ (no sao, đúng chốt).
Giám đốc: tạo lớp ✅, add HS ✅, email PH ✅, cancel lớp/buổi + confirm ✅, sửa/archive HS ✅, tạo/sửa PH ✅.
Nav đơn giản ✅. Audit "log hết" ✅ live-verified.
Chưa: upload học liệu/buổi (2b), HS làm/nộp verify (2a), PH reporting nâng cao, staff-mgmt (5a).
