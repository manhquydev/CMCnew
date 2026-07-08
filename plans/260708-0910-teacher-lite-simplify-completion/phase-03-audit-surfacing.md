---
phase: 3
title: "Audit surfacing"
status: pending
priority: P1
effort: "M"
dependencies: []
---

# Phase 3: Audit surfacing ("log hết" — đọc được)

## Overview

Audit ĐÃ ghi đủ (attendance/grade/session-evidence/guardian đều gọi `logEvent`), nhưng **chưa đọc được**
vì entityType không trong whitelist `NOTE_TARGETS` + không có UI `<Chatter>`. Phase này mở read-side để
đáp ứng "ghi lại hết ai làm gì lúc nào", đặc biệt "ai điểm danh học sinh lúc nào".

## Requirements
- Functional: session-detail teacher-lite có panel "Lịch sử" hiện timeline sự kiện của buổi (điểm danh,
  chấm bài, nhật ký) với tên actor + thời gian.
- Functional: sự kiện grade/session-evidence/guardian đọc được (fold vào timeline student/class_session/class_batch).
- Non-functional: giữ tenancy — resolver facilityId từ chính record, không tin client (theo pattern NOTE_TARGETS hiện có).

## Architecture
- `apps/api/src/routers/audit.ts` — thêm `class_session` vào `NOTE_TARGETS` với resolver
  `tx.classSession.findUnique({where:{id}, select:{facilityId:true}})`. (unlock attendance + teacher-lite cancel-session events).
- Cân nhắc thêm `session_evidence`/`grade` vào whitelist HOẶC fold sự kiện đó vào timeline đã đọc được
  (`student` cho grade, `class_session` cho evidence) — quyết định UX ở validate.
- `guardian`/`parent_account`: fold vào timeline `student` (rẻ hơn thêm 2 whitelist).
- `apps/admin/src/teacher-schedule-session-detail.tsx` — thêm tab/panel `<Chatter entityType="class_session" entityId={session.id}>`.
- Reuse `<Chatter>` (`packages/ui/src/chatter.tsx`) — đã có, chỉ đặt vào chỗ mới.

## Related Code Files
- Modify: `apps/api/src/routers/audit.ts` (NOTE_TARGETS + resolver)
- Modify: `apps/admin/src/teacher-schedule-session-detail.tsx` (Chatter panel — tab "Lịch sử")
- Maybe modify: `apps/api/src/routers/grade.ts` / `session-evidence.ts` / `guardian.ts` (fold entityId nếu chọn fold thay vì whitelist)
- Reuse: `packages/ui/src/chatter.tsx`, `packages/audit/src/index.ts` (logEvent/getTimeline)

## Implementation Steps
1. Thêm `class_session` resolver vào NOTE_TARGETS (audit.ts). Confirm classSession luôn có facilityId non-null.
2. Thêm tab "Lịch sử" trong session-detail 4-tab (thành 5 tab, hoặc panel dưới) render `<Chatter entityType="class_session">`.
3. Quyết định fold vs whitelist cho grade/session_evidence/guardian (validate). Nếu fold: đổi entityId khi logEvent để trỏ về entity đọc được.
4. Verify tenancy: staff cơ sở B không đọc được timeline buổi cơ sở A (RLS + resolver).
5. Typecheck api + admin.

## Success Criteria
- [ ] Session-detail hiện "ai điểm danh HS X lúc HH:MM ngày DD/MM" (actor + timestamp).
- [ ] Grade/evidence events đọc được ở đâu đó hợp lý (student/class_session timeline).
- [ ] Guardian events đọc được (student timeline).
- [ ] Cross-facility read bị chặn.
- [ ] typecheck 0 lỗi; integration test tenancy pass.

## Risk Assessment
- Rủi ro tenancy: thêm entityType vào NOTE_TARGETS mà quên resolver facilityId → rò rỉ cross-facility.
  Mitigate: resolver bắt buộc + integration test cross-facility deny.
- `class_session` cancel event (teacher-lite) sẽ tự đọc được sau khi whitelist — bonus, verify không vỡ.
