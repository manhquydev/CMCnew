# Phase 0 — Hardening backlog (từ adversarial review 2026-06-23)

## ✅ Đã xử lý ngay
- RLS cho `app_user` (chỉ super_admin đọc) — chống enumerate user xuyên facility.
- Trigger tự tăng `token_version` khi `is_active=false` — vô hiệu hóa user = khóa JWT tức thì.
- `errorFormatter` xóa stack trace khỏi mọi response tRPC (không phụ thuộc NODE_ENV).
- CORS origin lấy từ env `CORS_ORIGINS` (mặc định cổng dev), sẵn sàng production.
- JWT secret tối thiểu **32 ký tự** (HS256).
- Seed chặn mật khẩu mặc định trong production.
- `withRls` validate `facilityIds` là số nguyên dương (chống lỗi cast int[]).

## ⏸️ Hoãn lại (ghi nợ, xử lý ở phase hardening/khi cần)
| Mục | Mức | Ghi chú |
|---|---|---|
| Rate-limit đăng nhập (chống brute-force) | MED | Có Redis sẵn; làm khi mở đăng nhập rộng (Phase 1+). |
| Không export raw `prisma` client (footgun bỏ quên `withRls`) | MED | Hiện mọi router đều dùng `withRls`. Cân nhắc lint rule cấm `prisma.*` ngoài `withRls`. |
| Rà soát lại `course` facility-scope vs global (RLS) | HIGH-spec | Quyết ở spec Phase 1 (xem câu hỏi nghiệp vụ). |

## ❌ Bác bỏ (không phải lỗi)
- "GUC leak khi connection pooling": **không đúng** — `set_config(...,true)` là transaction-local, Postgres reset cuối tx; Prisma giữ 1 connection cho interactive transaction. Live QA đã xác minh cô lập đúng.
- `app_facility_ids()` trả NULL → deny: đây là **default-deny an toàn theo thiết kế**, không phải lỗi.

## Phase 1 polish
- RLS WITH CHECK bị vi phạm (vd tạo record ở facility ngoài quyền) hiện ra INTERNAL_SERVER_ERROR — nên map sang FORBIDDEN ở tầng tRPC cho UX rõ ràng. Bảo mật đã đúng (bị từ chối), chỉ là mã lỗi.
