# CMCnew — Creative Maieutic Center (ERP + LMS)

> **THINK · CREATE · LEAD** — Gợi mở tư duy, Kiến tạo thế giới

Bản build lại **sạch, greenfield** của hệ thống CMC: một nền tảng **ERP + LMS** thống nhất cho 3 chương trình giáo dục UCREA / Bright I.G / Black Hole (độ tuổi 3–11).

Dự án này thay thế hệ cũ ở `D:\project\CMC` (đang dở dang cuộc di cư khỏi Odoo, dữ liệu trùng 3 kho, tài liệu lỗi thời). CMCnew **bỏ Odoo, bỏ tầng sync**, gom về **một codebase + một database**.

> ⚠️ Hệ cũ **chưa có dữ liệu thật** (toàn seed/demo) → không có gánh nặng migration. Bắt đầu thật sự từ đầu.

## Tài liệu nền tảng (nguồn sự thật)

| Tài liệu | Nội dung |
|---|---|
| [docs/project-charter.md](docs/project-charter.md) | Tầm nhìn, phạm vi (in/out), người dùng, **master list module**, business rules, glossary |
| [docs/adr/0001-stack-and-architecture.md](docs/adr/0001-stack-and-architecture.md) | Quyết định stack + kiến trúc, kèm giải trình trade-off |
| [docs/roadmap.md](docs/roadmap.md) | Lộ trình theo rủi ro (Phase 0 → 5) + nhánh mobile |

## Nguyên tắc bất biến

1. **Một database duy nhất.** Không trùng thực thể qua nhiều kho. Postgres + RLS cô lập theo cơ sở (facility).
2. **Nghiệp vụ nặng nằm trong package domain** (chấm điểm, học phí, lương, xếp lịch) — không nhét trong route. Đây là rào chống "chắp vá".
3. **Parity trước, nâng cấp sau.** v1 tái hiện đủ module hệ cũ một cách sạch.

## Chạy local (dev)

```bash
pnpm install
pnpm db:up                       # Postgres 16 (5433) + Redis (6380) qua Docker
cp .env.example .env             # điền secret dev (đã .gitignore)
pnpm --filter @cmc/db generate
pnpm --filter @cmc/db migrate    # schema + RLS (tạo role cmc_app)
pnpm --filter @cmc/db seed       # super_admin + 2 facility demo

# chạy backend + 2 app (mỗi lệnh 1 terminal, hoặc `pnpm dev` chạy tất cả qua turbo)
# Topology: 1 API + app nhân viên hợp nhất (admin) + app LMS. apps/teaching đã retire,
# gộp toàn bộ panel giáo vụ vào apps/admin (staff shell lọc theo role).
pnpm --filter @cmc/api start     # http://localhost:4000
pnpm --filter @cmc/admin dev     # http://localhost:5173  (app nhân viên hợp nhất: ERP + giáo vụ)
pnpm --filter @cmc/lms dev       # http://localhost:5175
```

Đăng nhập demo: `admin@cmc.local` / `ChangeMe!123` (đổi qua biến `SEED_SUPERADMIN_*`).

Kiểm chứng RLS: `pnpm --filter @cmc/db exec tsx src/verify-rls.ts`.

## Trạng thái (cập nhật 2026-06-24)

🟢 **Làm rõ phạm vi** (flow: Idea → Research → Scope) — hoàn tất.
🟢 **Phase 0 — Nền tảng** — hoàn tất & có bằng chứng: RLS cô lập facility (verified), API login/RBAC/guards (curl), 3 app build + đăng nhập admin trên live URL.
🟢 **Phase 1–4 — đã build** (academic core, assessment/LMS, revenue/CRM, payroll v2): 5 package domain, 112 unit-test PASS, 8 integration test khóa invariant tiền/tenancy/lương (mutation-proven).
🟡 **Đang làm — Làm chắc nghiệp vụ** (nhánh `test/invariant-integration-harness`): lưới integration test + CI gate. Xem `plans/20260624-business-hardening/plan.md`.
⬜ **Phase 5 — After-sale, Guardian, Exec** — chưa làm (xem `docs/roadmap.md`).

> ⚠️ **Chưa chứng minh / nợ rõ:**
> - **CI chưa chạy thật** — `.github/workflows/ci.yml` đã định nghĩa đủ step nhưng repo **chưa có git remote** → CI chưa từng thực thi. Push/PR bị chặn đến khi thêm remote.
> - **Lint chưa dựng** — chưa có eslint; script `lint` ở root là no-op.
> - **Cadence họp PH** (UCREA 5/BI+BH 3 buổi/tháng) ở spec, **chưa enforce trong code** — quyết định mở.
