---
phase: 4
title: "CRUD completion"
status: pending
priority: P1
effort: "M"
dependencies: [3]
---

# Phase 4: CRUD completion (HS/PH sửa-xóa + audit)

## Progress (2026-07-08)
- **4a DONE (`80bbe83`):** widen `student.update` += `giam_doc_dao_tao` (user-approved). GĐĐT sửa được HS
  (UI students-panel có sẵn; nav gate dùng student.update nên section tự hiện cho GĐĐT).
- **4b IN PROGRESS:**
  - ✅ `teacherLite.studentArchive` (`d2b7c23`): service + gate + audit + UI nút "Lưu trữ" + confirm modal. Student.archivedAt.
  - ✅ `guardian.parentUpdate` + audit `parentCreate` (`8ec27d4`): backend + gate [KD,DT]. ParentAccount system-wide → audit facilityId=null.
  - ⏳ Còn: UI sửa PH (guardians-panel chưa có bảng row-action) + `parentArchive` (deactivate isActive — cần product call semantics).

## Overview

Hoàn thiện CRUD học viên + phụ huynh trên teacher-lite: thêm student archive (soft-delete), parent
staff-edit + archive, audit `parentCreate`, và mở reachability đúng vai trò. Student edit đã có (giữ).

## Requirements
- Functional: HS có nút archive (soft-delete, set `archivedAt`) — không hard-delete.
- Functional: giám đốc sửa được thông tin PH (displayName/email/phone) + archive PH (sau khi hết link).
- Functional: mọi mutation ghi `logEvent` đọc được (fold vào student timeline khi hợp lý).
- Non-functional: gate quyền đúng `[giam_doc_kinh_doanh, giam_doc_dao_tao]`; giữ RLS.

## Architecture
- Backend mới (`apps/api/src/routers/student.ts`): `archive` mutation — set `archivedAt`, gate + `logEvent(student, archived)`.
- Backend mới (`apps/api/src/routers/guardian.ts`):
  - `parentUpdate` — sửa displayName/email/phone của ParentAccount (gate [KD,DT]) + `logEvent(parent_account, updated, changes)`.
  - `parentArchive` — soft-delete ParentAccount sau khi kiểm tra không còn Guardian link active + `logEvent`.
  - `parentCreate` — thêm `logEvent(parent_account, created)` (hiện thiếu).
- Frontend: `apps/admin/src/students-panel.tsx` (nút archive), `apps/admin/src/guardians-panel.tsx`
  (modal sửa PH + nút archive), `apps/admin/src/student-detail.tsx` (đã có History tab — reuse).
- Reachability: xem lại nav gate `students`/`guardians` — có thể cần widen cho giám đốc theo vai trò
  (CRUD-5: GĐĐT sửa student?). Quyết định ở validate.

## Related Code Files
- Modify: `apps/api/src/routers/student.ts` (+archive), `apps/api/src/routers/guardian.ts` (+parentUpdate, +parentArchive, audit parentCreate)
- Modify: `apps/admin/src/students-panel.tsx`, `apps/admin/src/guardians-panel.tsx`
- Maybe modify: `packages/auth/src/permissions.ts` (student.update thêm giam_doc_dao_tao — nếu validate chốt), nav-permissions
- Reuse: `packages/audit` logEvent, `<Chatter>` cho parent timeline

## Implementation Steps
1. Backend `student.archive` + audit; đảm bảo `list` đã filter `archivedAt:null` (đã có).
2. Backend `guardian.parentUpdate` + `guardian.parentArchive` (check no active link) + audit `parentCreate`.
3. UI: nút archive HS (confirm modal), modal sửa PH, nút archive PH.
4. (nếu validate chốt) parent detail view + `<Chatter entityType="parent_account">`.
5. Reachability: quyết định vai trò nào thấy Students/Guardians; áp gate.
6. Typecheck + integration test (archive không hard-delete; audit ghi; cross-facility deny).

## Success Criteria
- [ ] HS archive được (soft) → biến mất khỏi list; timeline ghi "archived by X".
- [ ] PH sửa được (name/email/phone) + archive được; audit đọc được.
- [ ] `parentCreate` ghi audit.
- [ ] Vai trò đúng thấy/không thấy section HS/PH.
- [ ] typecheck + integration green.

## Risk Assessment
- Rủi ro: archive PH khi còn HS link → orphan HS. Mitigate: chặn archive nếu còn Guardian link active.
- Rủi ro: hard-delete nhầm → dùng soft (archivedAt) toàn bộ, không hard-delete.
- Rủi ro authz: widen student.update cho DT là đổi quyền → cần xác nhận user (CRUD-5) trước khi làm.
