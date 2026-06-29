# Plan — Sales-ops + DB foundations (B1/B2/B4/E3)

**Status:** IMPLEMENTED (2026-06-29) — P1+P2+P3 xong; full typecheck workspace xanh; API 393/394 (fail duy nhất `email otp_login` là pre-existing, không liên quan); code-review APPROVE_WITH_NITS. Còn 1 MEDIUM chờ user quyết (validate owner UUID — xem §Follow-up).
**Branch:** develop · **Lane:** normal (Data-model migration + Existing CRM behavior; không đụng auth/payment/data-loss).
**Nguồn:** `plans/reports/grounding-and-ai-integration-brainstorm-260629-1047-cmcnew-leverage-report.md` (Nhóm 1 greenlight, user chốt 2026-06-29).

## Phạm vi vòng này
| ID | Hạng mục | Tóm tắt |
|---|---|---|
| B1 | Sổ phân bổ lead | Model `OpportunityAssignment` (append-only) + log khi tạo/đổi owner + procedure `reassign` + xem lịch sử |
| B2 | Quy nguồn kênh | Thêm `medium`, `campaign` (cấu trúc) cho `Contact`; nhập ở contactCreate/leadIngest; hiển thị |
| B4 | Lý do mất chuẩn hoá | `Opportunity.lostReason` free-text → enum `LostReason` (+ note tuỳ chọn) |
| E3 | Index bảng lớn | Thêm index theo truy vấn thật: Attendance(enrollmentId), Submission(studentId), Enrollment(studentId), ClassSession(facilityId, sessionDate) |

## NGOÀI phạm vi (đã chốt)
- **E1** (idempotency worker): **đã đạt** — EmailOutbox có dedupKey + lease + overlap-guard; ParentMeeting idempotent. Ghi backlog: multi-replica cần `SELECT … FOR UPDATE SKIP LOCKED`.
- Bỏ hẳn: B3, B5, C1/C2, F4, D3, 2FA, e-invoice, care-theo-buổi.
- Để sau: AI (mua Azure), C3, D1/D2, E2, F1/F2/F3.
- **Không** đổi row-scoping CRM (user Q1: sale thấy mọi lead của cơ sở — giữ nguyên RLS facility).

## Phases
| Phase | File | Mô tả | Phụ thuộc |
|---|---|---|---|
| 1 | [phase-01-db-schema-migration.md](phase-01-db-schema-migration.md) | Schema + 1 migration: enum LostReason, Contact fields, OpportunityAssignment, indexes | — |
| 2 | [phase-02-crm-api-logic.md](phase-02-crm-api-logic.md) | tRPC: assignment log + reassign, attribution capture, lostReason enum; permission registry | P1 |
| 3 | [phase-03-admin-crm-ui.md](phase-03-admin-crm-ui.md) | Admin CRM UI: source/medium/campaign input, lost-reason dropdown, assignment history | P2 |

## Acceptance (toàn plan)
- B1: mọi lần set/đổi `Opportunity.ownerId` ghi đúng 1 dòng `OpportunityAssignment` (assignedById, từ→đến, lý do); xem được lịch sử; không sửa/xoá được dòng cũ.
- B2: contactCreate/leadIngest nhận & lưu `medium`/`campaign`; hiển thị trên contact.
- B4: markLost chỉ nhận giá trị enum hợp lệ; danh sách lọc theo lý do mất; dữ liệu free-text cũ migrate sang `other`.
- E3: 4 index mới tồn tại; `prisma migrate` chạy sạch; không đổi public contract ngoài các field thêm.
- Toàn bộ: `pnpm typecheck` + test liên quan xanh; không regression CRM/finance (Opportunity.ownerId vẫn chảy vào Receipt.soldById tại approve).

## Rủi ro & rollback
- Migration enum cho `lostReason`: cần backfill free-text cũ → `other` trước khi đổi cột (làm trong cùng migration, expand→backfill→constrain).
- `ownerId` đang nuôi commission (Receipt.soldById tại approve) → B1 chỉ THÊM log, không đổi nghĩa ownerId. Walk touchpoint finance.receiptApprove khi review.
- Rollback: migration revert + gỡ field/model mới (chưa có dữ liệu prod cho các field mới → an toàn).

## Validation
- Integration test theo pattern harness hiện có (apps/api/test): assignment log on create/reassign; lostReason enum guard; attribution persisted. Đăng ký story `harness-cli story add` sau khi duyệt.
