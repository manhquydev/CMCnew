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

## Unresolved
1. P2a cần user cấp tài khoản HS test (login) để verify luồng LMS thật.
2. P4b/P5a: schema Student.archivedAt / ParentAccount / Guardian cần verify trước khi viết mutation.
