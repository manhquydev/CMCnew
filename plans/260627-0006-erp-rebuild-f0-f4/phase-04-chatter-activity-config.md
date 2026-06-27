# F4 — Chatter/activity sidebar + config-as-code

Rủi ro: TB. Phụ thuộc: F2.

## Context
- `plans/reports/gap-analysis-260626-2338-business-completeness-report.md`
- xia: `10_notification_chatter.md`, `04_grading_assessment.md`

## Requirements
1. **Chatter/activity sidebar:** hiển thị `RecordEvent` (audit đã có) thành lịch sử trên các record chính (Student, Opportunity, Receipt, Class). Follower fan-out: `getFollowers` hiện read-only → thêm fan-out thông báo (SSE đã có hạ tầng).
2. **RecordActivity (task model)** — nếu user xác nhận cần staff inbox "việc cần làm" kiểu Odoo. Nếu không, chỉ làm sidebar lịch sử.
3. **Config-as-code:**
   - Trọng số grading: thêm cột weight cho `GradingTemplate` (bỏ hardcode theo program).
   - Khóa kỳ/điểm: `isLocked` cho term/grade (chặn sửa sau khi chốt).
   - Badge quota (nếu trong scope rewards).

## Files (dự kiến)
- `packages/db/prisma/schema.prisma`: `RecordActivity` (nếu cần), weight cols, `isLocked` + migration.
- `apps/api/src/routers/*`: fan-out follower→SSE; activity CRUD; grading dùng weight DB.
- `packages/ui`: ChatterSidebar + (ActivityInbox nếu cần).
- `packages/domain-grading`: đọc weight từ DB thay hardcode.

## Steps
1. Chốt với user: có cần staff inbox (RecordActivity) hay chỉ sidebar lịch sử.
2. ChatterSidebar đọc RecordEvent (read trước).
3. Follower fan-out → SSE.
4. Migration weight + isLocked; chuyển grading sang weight DB; chặn sửa khi locked.
5. (Tùy chọn) ActivityInbox.

## Validation
- Sidebar hiển thị đúng lịch sử theo record, RLS-safe.
- Đổi weight DB → điểm tính lại đúng; khóa kỳ chặn sửa.
- build + typecheck xanh.

## Risks / Rollback
- Đổi nguồn weight đụng điểm đã tính → chỉ áp cho kỳ mở; kỳ đã khóa giữ nguyên.

## Cần user chốt
- Staff inbox RecordActivity: làm hay defer?
