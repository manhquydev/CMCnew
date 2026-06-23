# ADR 0001 — Stack & Kiến trúc nền tảng

- **Trạng thái:** Đề xuất (chờ duyệt)
- **Ngày:** 2026-06-23
- **Bối cảnh quyết định bởi:** giao toàn quyền cho engineer + giải trình.

## Bối cảnh

Build lại greenfield ERP + LMS cho CMC. 3 app (LMS, Teaching/ERP, Admin) dùng chung dữ liệu. Hệ cũ rối vì 3 kho dữ liệu song song (Odoo + LMS Prisma Next.js + internal Hono/tRPC SPA RLS) và migration dở dang. Phần **sạch & tiến hóa nhất của hệ cũ** là internal portal: **Hono + tRPC + React/Vite + Prisma + Postgres/RLS**. Không có dữ liệu thật → tự do chọn.

Ràng buộc: parity nghiệp vụ hệ cũ; thêm realtime push; mobile app (nhánh sau) dùng chung API; chống tái diễn "chắp vá".

## Quyết định

**Monorepo TypeScript, một backend, một database, nghiệp vụ tách thành package domain.**

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Chia sẻ type & domain giữa 3 app + API + worker + mobile |
| Ngôn ngữ | TypeScript xuyên suốt | Một ngôn ngữ, type-safe end-to-end |
| Database | **PostgreSQL 16, 1 DB, RLS** đa cơ sở | Xóa trùng 3 kho; cô lập facility ở tầng DB (defense-in-depth) |
| ORM/Schema | Prisma 7 (nguồn schema + migration) | Đã chứng minh ở hệ cũ; type-safe |
| API | **tRPC trên Hono** | Type-safe client↔server không codegen; Hono nhẹ, hỗ trợ SSE/WS |
| Frontend | **React + Vite SPA** ×3 (lms/teaching/admin) | Cả 3 là cổng đăng nhập (không cần SEO/SSR); khớp phần internal đang tốt |
| UI kit | **Mantine** (DataTable/Form/Calendar/Modal/Notifications) | ERP nhiều bảng/form/lịch → kit đầy đủ build nhanh, nhất quán; nhận design token brand |
| Xóa dữ liệu | **Soft-delete/archive mọi nơi** (active/archivedAt) + audit log | Minh bạch kiểu Odoo: giữ lịch sử, khôi phục được (quyết định 2026-06-23) |
| Realtime | SSE (tRPC subscriptions) | Thay polling cho thông báo/chat |
| Auth | JWT cookie chia sẻ subdomain + `tokenVersion` + role/facility resolve từ DB | Thu hồi tức thì; scope không nằm trong token |
| Background jobs | BullMQ + Redis (worker riêng) | Cron họp PH, KPI snapshot, chứng chỉ, fan-out thông báo |
| Validation | Zod (dùng chung API + domain) | Một nguồn schema runtime |
| Mobile (sau) | Expo / React Native trên cùng tRPC | Chia sẻ type API, không backend riêng |

### Cấu trúc monorepo

```
CMCnew/
  apps/
    lms/         # React+Vite SPA — học sinh + phụ huynh
    teaching/    # React+Vite SPA — giáo viên/kế toán/HR/sale/cskh (ERP)
    admin/       # React+Vite SPA — super_admin/BGĐ
    api/         # Hono + tRPC — backend duy nhất
    worker/      # BullMQ jobs
  packages/
    db/          # Prisma schema + client + RLS policies + migrations + seed
    domain-academic/   # lớp/enrollment/lịch/điểm danh
    domain-grading/    # 3 công thức điểm UCREA/BI/BH, rubric
    domain-fees/       # phiếu thu/voucher/discount (trần 35%)
    domain-payroll/    # PIT 7 bậc, finalize gating
    domain-crm/        # O1–O5 state machine
    domain-rewards/    # sao/quà/huy hiệu (atomic)
    auth/        # session/JWT/RBAC/RLS context
    ui/          # React components + design tokens dùng chung
    config/      # tsconfig/eslint/prettier base
```

**Nguyên tắc bất biến chống chắp vá:** logic nghiệp vụ thuần (tính điểm, lương, học phí, xếp lịch, state machine CRM) **chỉ** nằm trong `packages/domain-*`, framework-agnostic, unit-test độc lập. tRPC router chỉ điều phối + RLS + validation, không chứa quy tắc nghiệp vụ.

## Trade-off / Phương án bị loại

- **Next.js toàn bộ (App Router + RSC):** quen thuộc, SSR/SEO, server actions. **Loại** vì: cả 3 app là cổng đăng nhập (không cần SEO), phải viết lại phần internal SPA đang tốt, RSC + realtime + tRPC nặng hơn nhu cầu. Website public (đã có) mới là nơi cần SEO — nằm ngoài phạm vi.
- **Giữ Odoo:** loại theo quyết định nghiệp vụ — đây là nguồn "chắp vá" số 1.
- **Microservices / nhiều DB:** loại — chính là lỗi của hệ cũ (3 kho). Modular monolith + domain packages cho ranh giới rõ mà không trả giá vận hành.
- **Drizzle thay Prisma:** trung lập; giữ Prisma vì hệ cũ đã chứng minh + RLS pattern sẵn.

## Hệ quả

- ✅ Một nguồn sự thật dữ liệu; không sync.
- ✅ Type an toàn từ DB → API → 3 web → mobile.
- ✅ Nghiệp vụ test được độc lập framework.
- ⚠️ Mất SSR (chấp nhận — cổng đăng nhập); cần xử lý SEO riêng nếu sau này gắn website.
- ⚠️ RLS phải phủ **mọi** bảng tenant (rút từ lỗi `course` hệ cũ) — đưa vào checklist Phase 0.
