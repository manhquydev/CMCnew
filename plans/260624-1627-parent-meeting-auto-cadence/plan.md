# Plan — T13: Auto-cadence họp phụ huynh

> Chốt nghiệp vụ (chủ dự án 2026-06-24): hệ **auto-sinh lịch họp PH theo cadence**, neo = `class.startDate`, **spec-strict** (không họp đột xuất → bỏ tạo tay). Lane: high-risk (migration + cron + đổi hành vi PM2/PM3 hiện có) → int-test + 2-agent review trước khi đóng.

## Quyết định thiết kế
- **Cadence theo program**: UCREA = 5 tháng, BRIGHT_IG = 3, BLACK_HOLE = 3.
- **Neo**: buổi N tại `startDate + N × interval` (N = 1,2,…). Không sinh buổi tại đúng ngày khai giảng.
- **Lớp được sinh**: `status = running` và `startDate != null`.
- **Horizon**: tới `endDate` nếu có; nếu không → cuốn tới `now + 12 tháng`.
- **Idempotent**: unique `(classBatchId, scheduledAt)` + `createMany skipDuplicates`. Ngày sinh tất định nên chạy lại không nhân đôi.
- **Tiêu đề auto**: `Họp phụ huynh định kỳ` (mốc trong title/payload).
- **Chặn đột xuất**: bỏ mutation `parentMeeting.create`; UI bỏ form tạo, giữ list + setStatus (đã họp/hủy). Reminder (T-1) giữ nguyên.

## Slices
| # | Việc | File | Verify |
|---|---|---|---|
| S1 | Pure fn cadence | `packages/domain-academic/src/parent-meeting-cadence.ts` (+ index, +unit test) | unit: UCREA 5th/ BI 3th sinh đúng mốc trong horizon |
| S2 | Schema unique + migration | `packages/db/prisma/schema.prisma` `@@unique([classBatchId, scheduledAt])` + `migrate:dev` | migrate applied |
| S3 | Service generate | `apps/api/src/services/parent-meeting-cadence.ts` | iterate running+startDate → createMany skipDuplicates + logEvent |
| S4 | Router + cron | `parent-meeting.ts` (bỏ `create`, thêm super-only `runCadence`) + `index.ts` cron daily | — |
| S5 | UI | `apps/teaching/src/App.tsx` MeetingsTab — bỏ form tạo, ghi chú auto | typecheck+lint |
| S6 | int-test | `apps/api/test/parent-meeting-cadence-autogen.int.test.ts` | lớp running UCREA → đúng số buổi; chạy 2× → không nhân đôi; `create` đã bỏ |
| S7 | 2-agent review | — | SAFE-TO-CLOSE |

## Bất biến
- Auto-gen idempotent (unique key). Reminder dedup `remindedAt` giữ nguyên.
- Không sinh cho lớp planned/open/closed/cancelled hoặc thiếu startDate.
- Bỏ tạo tay = không còn họp đột xuất (khớp spec/charter).

## Rủi ro / rollback
- Migration chỉ thêm unique index (không mất dữ liệu). Nếu có lịch tay trùng (classBatchId, scheduledAt) → migration fail → dọn trùng trước.
- Bỏ `create` đổi public contract → cập nhật UI cùng commit; client cũ gọi `create` sẽ lỗi (chủ ý).

## Câu hỏi mở
- "running" có đủ phủ "lớp active" không, hay gồm cả `open`? (đang chọn `running`.)
