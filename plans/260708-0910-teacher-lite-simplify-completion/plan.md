---
title: Teacher Lite Simplify + Completion
description: >-
  Đơn giản hóa teacher-lite (bỏ ERP-heavy), hoàn thiện luồng LMS PH+HS, surface
  audit log, CRUD HS/PH, giám đốc quản lý nhân sự gọn — giữ Decision 0039.
status: pending
priority: P1
branch: develop
tags:
  - teacher-lite
  - lms
  - audit
  - crud
  - nav-simplify
  - high-risk
blockedBy: []
blocks: []
relatedPlans:
  - >-
    260706-1752-session-level-exercises (pending — upload học liệu theo buổi;
    Phase 2 absorb/depend)
  - >-
    260702-1007-lms-homework-pdf-completion (completed — HS làm/nộp bài; Phase 2
    chỉ verify live)
  - >-
    260707-teacher-lite-direct-lms-mvp (local-verified — Decision 0039
    provisioning)
created: '2026-07-08T02:23:32.524Z'
createdBy: 'ck:plan'
source: skill
brainstormReport: plans/reports/audit-first-teacher-lite-deficiency-register-260708-report.md
---

# Teacher Lite Simplify + Completion

## Overview

Đóng gap + đơn giản hóa surface teacher-lite (`apps/admin` surface='teacher') **trên nền hiện có, GIỮ
Decision 0039** (chung DB/auth/LMS, không app/DB riêng). Mục tiêu cấp bách: teacher-lite trở thành hệ
thống nội bộ GỌN phục vụ **luồng LMS cho PH+HS là chính**, với 3 vai trò:
- **Giáo viên**: dạy học — điểm danh, nhận xét, ảnh lớp, chấm bài (điểm + feedback, KHÔNG sao).
- **Giám đốc**: tạo lớp, add HS (gửi email LMS), add HS vào lớp, upload học liệu theo buổi, cancel
  buổi/lớp, quản lý nhân sự (đội GV) bản GỌN.
- **HS/PH**: HS thấy bài → làm → nộp về GV (LMS app); PH nghiệp vụ tương ứng.

Nền tảng đã có (không xây lại): audit infra `@cmc/audit` (`RecordEvent`+`logEvent`+`<Chatter>`),
`teacherLite` router (createClass/cancelClass/cancelSession + audit), LMS draw-on-PDF submission
(plan `260702-1007` completed), student.update + student timeline.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Nav simplification](./phase-01-nav-simplification.md) | Completed (63cc3dc, deployed dev) |
| 2 | [LMS flow verify + session material upload](./phase-02-lms-flow-verify-session-material-upload.md) | Completed |
| 3 | [Audit surfacing](./phase-03-audit-surfacing.md) | Completed (52e90db, live-verified dev) |
| 4 | [CRUD completion](./phase-04-crud-completion.md) | Mostly done — 4a + studentArchive + parentUpdate/audit + parent edit UI; only parentArchive blocked (0033 decision) |
| 5 | [Director staff-mgmt + overview + cancel confirm](./phase-05-director-staff-mgmt-overview-cancel-confirm.md) | Completed |

## Nguyên tắc API bypass (user-directed 2026-07-08)

Teacher-lite được phép **bypass rào cản thiết kế ERP gốc** để làm đúng việc được định nghĩa: thêm/ dùng
endpoint `teacherLite.*` với gate ĐƠN GIẢN riêng (như `teacherLite.createClass/cancelClass` đã tách khỏi
`classBatch.*`). Áp dụng cho các phase sau:
- Phase 4: ưu tiên `teacherLite.studentArchive` / `teacherLite.parentUpdate` / `teacherLite.parentArchive`
  (gate [KD,DT], bypass workflow ERP) thay vì nới `student.*`/`guardian.*` gốc — TRỪ khi nới gate gốc đơn
  giản hơn (vd widen `student.update` cho GĐĐT đã user-approved).
- Phase 5: `teacherLite.staffList/staffCreate/staffUpdate` chỉ role `giao_vien`, bypass `user.*` ERP nặng.
- **GIỮ NGUYÊN (không bypass):** tenancy/RLS (facility scoping từ record, không tin client), chống
  role-escalation, audit `logEvent`. Bypass = bỏ rào workflow, KHÔNG bỏ rào bảo mật.
- **Giao diện:** bám prototype `D:\Downloads\Thiết kế UIUX LMS và ERP` cho workflow từng vai trò.

## Decision governance (Hard Rule)

- **Decision 0039** (`docs/decisions/0039-teacher-lite-direct-lms-mvp.md`) GOVERNS: giữ nguyên
  API/DB/RLS/auth/LMS; teacher-lite là surface đơn giản trên backend chung. Kế hoạch này **tuân thủ**
  0039 (không tạo hệ thống riêng). Simplification = ẩn/bỏ section ERP-heavy khỏi surface, KHÔNG xóa
  backend hay RLS.
- **Decision 0038** governs session-level exercises (Phase 2 phần upload). Không tái diễn giải.
- Nếu bất kỳ phase nào cần đổi behavior authz/data → dừng, tạo decision doc mới.

## Dependencies

- **Phase 2 ⟵ `plans/260706-1752-session-level-exercises` (pending)**: phần "upload học liệu theo buổi"
  = plan đó (schema migration + Decision 0038). Phase 2 hoặc thực thi plan đó, hoặc mark blockedBy.
- **Phase 2 verify ⟵ `plans/260702-1007-lms-homework-pdf-completion` (completed)**: luồng HS làm/nộp
  bài đã build → chỉ verify live, không build lại.
- Phase 3/4/5 độc lập backend, chỉ chung file nav (app-surface.ts, shell.tsx) với Phase 1 → Phase 1 làm trước.

## Acceptance Criteria (toàn plan)

- [ ] Teacher-lite nav CHỈ còn: dạy học (GV) + lớp/HS/PH/nhân sự-gọn (giám đốc) + LMS; sale/KPI/chấm
      công/finance/CRM biến mất khỏi nav teacher (vẫn ở ERP surface).
- [ ] KPI cockpit item gỡ bỏ (không dead-end redirect).
- [ ] HS login LMS thật (prod) → thấy file bài tập → làm → nộp → GV thấy bài nộp (verify live).
- [ ] Giám đốc upload học liệu gắn đúng buổi/lesson → HS thấy đúng buổi.
- [ ] Session-detail có panel "Lịch sử" (`<Chatter>`) hiện "ai điểm danh/chấm/sửa lúc nào".
- [ ] HS có nút xóa/archive; PH có sửa + xóa; mọi mutation ghi audit đọc được.
- [ ] Giám đốc thấy màn quản lý đội GV gọn (xem/thêm/sửa/phân công), không payroll/KPI.
- [ ] /overview stat thật (Bài chờ chấm, Nhận xét chờ chốt).
- [ ] Cancel lớp/buổi có modal xác nhận hiện cascade count.
- [ ] `pnpm --filter admin tsc --noEmit` + `--filter api` typecheck 0 lỗi; Jenkins develop green.
- [ ] Verify live prod luồng học viên.

## Lane: HIGH-RISK

Flags: Authorization (nav/section gates, staff-mgmt perms), External systems (LMS material upload/MinIO,
email PH), Data model (session-level exercise schema — Phase 2), Existing behavior (nav/provisioning),
Audit/security (audit surfacing). 4+ flags → high-risk. Cần red-team + validate trước khi build.

## Red-team findings + resolutions (2026-07-08, self-adversarial)

- **RT-1 (Phase 1 — cockpit approvals):** Strip finance/shift/checkin khỏi Set KHÔNG được phá inline-approve
  của cockpit (giám đốc duyệt receipt/shift/manual-punch NGAY trong cockpit, không navigate). Chỉ **KPI**
  route ra `/kpi` → dead-end. **Resolution:** Phase 1 chỉ gỡ KPI item; các inline-approve khác giữ nguyên
  (không cần section vì duyệt tại chỗ). Mất "inspect detail" jump là chấp nhận (dùng ERP surface).
- **RT-2 (Phase 2 — overlap nặng):** "upload học liệu theo buổi" = plan `260706-1752-session-level-exercises`
  (16h, schema migration, high-risk). Absorb sẽ nhân đôi rủi ro plan này. **Resolution:** TÁCH Phase 2:
  **2a** = verify live HS làm/nộp bài (rẻ, làm ngay — đã build ở `260702-1007`); **2b** = session material
  upload = **thực thi plan `260706-1752` riêng**, plan này `blockedBy` nó. Set quan hệ bidirectional.
- **RT-3 (Phase 3 — chốt fold vs whitelist, giảm churn):** whitelist **`class_session`** (bắt buộc cho
  attendance + cancel-session); **fold** grade→timeline `student`, evidence→`class_session`, guardian→`student`
  (không thêm whitelist mới). Concrete, ít thay đổi gate.
- **RT-4 (Phase 4 — authz change):** widen `student.update` cho `giam_doc_dao_tao` (CRUD-5) là ĐỔI QUYỀN →
  cần user xác nhận trước, KHÔNG tự làm. Các mutation mới (archive/parentUpdate/parentArchive) giữ gate
  [KD,DT] hiện hành, không mở rộng.
- **RT-5 (Phase 5 — escalation risk):** staff-mgmt-lite reuse `user.create/update` — powerful. Giám đốc
  **chỉ được tạo/sửa role `giao_vien`** trong bản gọn, KHÔNG tạo role khác / super_admin / self-escalate.
  Constrain ở cả UI + server-side gate. Đây là điểm red-team nặng nhất — validate phải soi.
- **RT-6 (Sequencing):** thứ tự an toàn = **1 → 3 → 4 → 5**, với **2a** chèn sớm (verify, độc lập) và **2b**
  tách plan riêng. Phase 1 trước vì đụng nav (app-surface/shell) mà Phase 5 cũng đụng.
- **RT-7 (Scope realism):** 5 phase high-risk = nhiều phiên. Quick-win value cao/rủi ro thấp = **Phase 1 +
  Phase 3 + 2a**. Phase 2b là plan lớn riêng. Phase 4/5 trung bình, 5 cần validate authz.

## Validate — đã chốt (2026-07-08)
1. RT-4: **CÓ** widen `student.update` thêm `giam_doc_dao_tao` (Phase 4).
2. RT-5: **CHỈ `giao_vien`** — staff-mgmt-lite (Phase 5) chỉ tạo/sửa role giao_vien, constrain UI + server; không role khác/super_admin/escalate.
3. RT-2/P2b: **DEFER** — làm P1→P3→P4→P5 trước; 2a (verify HS làm/nộp bài) làm ngay; 2b (upload theo buổi = plan `260706-1752`) làm đợt riêng sau.

**Thứ tự thực thi chốt:** Phase 1 → Phase 3 → Phase 4 → Phase 5 (+ 2a verify chèn sớm). Phase 2b defer.
