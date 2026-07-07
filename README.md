# CMCnew — Creative Maieutic Center (ERP + LMS)

> **THINK · CREATE · LEAD** — Gợi mở tư duy, Kiến tạo thế giới

Bản build lại **sạch, greenfield** của hệ thống CMC: một nền tảng **ERP + LMS** thống nhất cho 3 chương trình giáo dục UCREA / Bright I.G / Black Hole (độ tuổi 3–11).

Dự án này thay thế hệ cũ ở `D:\project\CMC` (đang dở dang cuộc di cư khỏi Odoo, dữ liệu trùng 3 kho, tài liệu lỗi thời). CMCnew **bỏ Odoo, bỏ tầng sync**, gom về **một codebase + một database**.

**Trạng thái hiện tại: đang chạy production thật** tại `erp.cmcvn.edu.vn` (ERP), `teacher.cmcvn.edu.vn` (Teacher Console cho giáo viên/đào tạo), và `hoc.cmcvn.edu.vn` (LMS), deploy tự động qua Jenkins CI/CD trên VPS riêng.

## Tài liệu nền tảng (nguồn sự thật)

| Tài liệu | Nội dung |
|---|---|
| [docs/project-charter.md](docs/project-charter.md) | Tầm nhìn, phạm vi (in/out), người dùng, **master list module**, business rules, glossary |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kiến trúc hệ thống hiện tại (backend/frontend/DB/deploy) |
| [docs/adr/0001-stack-and-architecture.md](docs/adr/0001-stack-and-architecture.md) | Quyết định stack + kiến trúc, kèm giải trình trade-off |
| [docs/decisions/](docs/decisions/) | Toàn bộ quyết định kỹ thuật đánh số (ADR), mỗi quyết định là 1 file |
| [docs/roadmap.md](docs/roadmap.md) | Lộ trình theo rủi ro (Phase 0 → 5) + nhánh mobile |
| [docs/codebase-summary.md](docs/codebase-summary.md) | Bản đồ module/file, tổng quan nhanh cho người mới |
| [docs/prod-deploy-security-runbook.md](docs/prod-deploy-security-runbook.md) | Runbook deploy + bảo mật production |
| [docs/HARNESS.md](docs/HARNESS.md) | Harness vận hành agent (intake/story/decision/trace) |
| [docs/CK_WORKFLOW.md](docs/CK_WORKFLOW.md) | Cách ClaudeKit (`/ck:*`) map vào Harness Task Loop |

## Nguyên tắc bất biến

1. **Một database duy nhất.** Không trùng thực thể qua nhiều kho. Postgres + RLS (Row-Level Security) cô lập theo cơ sở (facility).
2. **Nghiệp vụ nặng nằm trong package domain** (chấm điểm, học phí, lương, xếp lịch) — không nhét trong route. Đây là rào chống "chắp vá".
3. **Parity trước, nâng cấp sau.** v1 tái hiện đủ module hệ cũ một cách sạch.
4. **Deploy phải tự-verify.** Mỗi bước hạ tầng (cert, migration, resource limit) phải tự kiểm tra và fail-loud thay vì âm thầm bỏ qua — xem `docs/decisions/0029-*.md` và bài học ở `docs/journals/260702-2100-jenkins-migrate-stale-image-fix.md`.

## Kiến trúc & stack

Monorepo `pnpm` + `turbo`.

```
apps/
  api/       Hono + tRPC — backend duy nhất, mọi business logic đi qua đây
  admin/     App nhân viên hợp nhất — ERP + panel giáo vụ (apps/teaching đã retire, gộp vào đây)
  lms/       App học sinh/phụ huynh — làm bài tập, xem điểm, đăng nhập OTP
  e2e/       Playwright smoke test (admin-smoke, lms-smoke)

packages/
  db/                 Prisma schema + migrations + RLS policy + seed
  auth/                Session/JWT, RBAC, SSO (Microsoft Entra)
  audit/                Chatter/audit-log kiểu Odoo, cross-cutting cho mọi entity
  ui/                  Design tokens + component dùng chung 2 app frontend
  domain-academic/      Xếp lịch, điểm danh, session, curriculum
  domain-grading/       Công thức tính điểm UCREA/BI/BH, rubric
  domain-finance/       Phiếu thu, voucher, discount tier, đối soát
  domain-payroll/       Lương, PIT 7 bậc, ca làm, chấm công
  domain-rewards/       Sao, quà, huy hiệu, leaderboard
```

**Backend**: Hono + tRPC (type-safe end-to-end), Prisma + Postgres 16 với RLS cô lập theo `facility_id`. Redis khai báo sẵn nhưng chưa dùng (rate-limit hiện tại chạy in-process).

**Auth**: session cookie + JWT; SSO qua Microsoft Entra cho nhân viên (`STAFF_EMAIL_DOMAIN` khóa domain); OTP qua email cho phụ huynh/học sinh đăng nhập LMS (passwordless).

**Email**: 2 kênh gửi song song kể từ [decision 0030](docs/decisions/0030-email-brevo-external-transport-split.md) — Microsoft Graph cho nhân viên nội bộ (tenant-to-tenant, ổn định), **Brevo** cho người nhận ngoài hệ thống (phụ huynh) vì M365 tenant bị Microsoft chặn reputation (`550 5.7.708`) khi gửi email ra ngoài. Routing tự động theo domain người nhận (`apps/api/src/lib/email-routing.ts`). Brevo đã được cấu hình trên production cho email phụ huynh; kiểm tra 2026-07-06 ghi nhận `BREVO_*` set và `email_outbox` có `brevo sent=4 failed=0 queued=0` theo truy vấn tổng hợp không in secret.

## Chạy local (dev)

```bash
pnpm install
pnpm db:up                       # Postgres 16 (5433) + Redis (6380) qua Docker
cp .env.example .env             # điền secret dev (đã .gitignore)
pnpm --filter @cmc/db generate
pnpm --filter @cmc/db migrate    # schema + RLS (tạo role cmc_app)
pnpm --filter @cmc/db seed       # super_admin + 2 facility demo

# chạy backend + 2 app (mỗi lệnh 1 terminal, hoặc `pnpm dev` chạy tất cả qua turbo)
pnpm --filter @cmc/api start     # http://localhost:4000
pnpm --filter @cmc/admin dev     # http://localhost:5173  (app nhân viên hợp nhất: ERP + giáo vụ)
pnpm --filter @cmc/lms dev       # http://localhost:5175
```

Đăng nhập demo: `admin@cmc.local` / `ChangeMe!123` (đổi qua biến `SEED_SUPERADMIN_*`).

Kiểm chứng RLS: `pnpm --filter @cmc/db exec tsx src/verify-rls.ts`.

**Kiểm tra trước khi commit** (bắt buộc theo `AGENTS.md`):

```bash
pnpm --filter @cmc/api typecheck && pnpm --filter @cmc/api lint
bash scripts/ci-integration-tests.sh   # spin ephemeral Postgres, chạy full integration suite
```

## Production

| Domain | App | Ghi chú |
|---|---|---|
| `erp.cmcvn.edu.vn` | Admin (ERP + giáo vụ) | Cloudflare-proxied, TLS "Full" (origin cert self-signed, xem decision 0029) |
| `teacher.cmcvn.edu.vn` | Teacher Console | cùng admin SPA/API, nhưng host-aware branding/nav/landing cho giáo viên và đào tạo; SSO trả về đúng host khởi tạo |
| `hoc.cmcvn.edu.vn` | LMS | cùng stack, cùng VPS |
| `ci.cmcvn.edu.vn` | Jenkins | single-node CI/CD, cùng VPS |

**Deploy pipeline** (`Jenkinsfile`): PR → lint + typecheck + integration test (bắt buộc trước merge) → merge `main` → build 3 Docker image (api/admin/lms) → `prisma migrate deploy` (image vừa rebuild, không dùng cache cũ) → `docker compose up -d` → smoke test qua domain thật → xong. Không cần SSH tay để deploy — `git push`/merge là đủ.

**Hạ tầng đã hardening** (2026-07-03, xem `plans/260703-0022-devops-tier1-hardening/`):
- TLS origin cert tự sinh + tự verify mỗi lần deploy (`scripts/ensure-origin-cert.sh`), không cần bootstrap tay.
- Docker resource limit trên cả 9 service prod, tính theo capacity thật của VPS (2 vCPU / 7.8 GiB).
- Jenkins publish check `CMCnew CI` lên GitHub PR (hiện mới report-only, chưa bật required-check — xem ghi chú unresolved trong `plans/260703-0022-devops-tier1-hardening/plan.md`).

**CI gate hiện tại**: `.github/workflows/ci.yml` chạy lint/typecheck/test/build như gate tham chiếu trên PR và `main`; Jenkins vẫn là deploy pipeline thật cho `develop`/`main`, gồm build image, migrate, deploy stack và smoke domain thật.

## Trạng thái (cập nhật 2026-07-03)

🟢 **Phase 0–4** — hoàn tất & có bằng chứng: RLS cô lập facility (verified), API login/RBAC/SSO/OTP, 3 app build + deploy live trên domain thật, harness story + integration test + E2E smoke cho từng module (xem bảng evidence registry ở `docs/roadmap.md`).

🟢 **DevOps Tier-1 hardening** (2026-07-03) — TLS reconciliation, resource limits, CI publish-check đã merge `main` và **đang soak 48h trên prod** trước khi coi là ổn định (không OOM, không lỗi kể từ khi lên).

🟢 **Email dual-transport** (2026-07-06) — Graph (nội bộ) + Brevo (ngoài hệ thống) đã chạy trên production; Brevo parent-mail readiness được xác nhận bằng config presence và `email_outbox` aggregate, không in secret.

🟡 **Dev/prod CI/CD split** — plan đã viết (`plans/260703-0052-dev-prod-cicd-environments/`), **chưa bắt đầu implement**: chờ soak 48h ở trên xong, và cần người thật thao tác 4 việc không thể tự động (đăng ký Entra redirect URI, xác nhận Cloudflare SSL mode, lấy Entra client secret, đăng nhập SSO qua trình duyệt thật).

⬜ **Phase 5 — After-sale, Guardian, Exec** — phần lớn đã làm (xem `docs/roadmap.md`), Dashboard BGĐ/MAES còn thiếu công thức MAES.

> ⚠️ **Nợ kỹ thuật đã biết:**
> - CI required-check (`CMCnew CI` trên GitHub) chưa thực sự chặn merge — chỉ report, chưa bật `scripts/setup-github-required-check.sh` (check-run có lúc không post lên GitHub, nguyên nhân gốc chưa xử lý dứt điểm — xem plan #1).
> - Redis khai báo trong compose nhưng chưa được dùng thật (rate-limit đang in-process, chỉ đúng cho 1 instance).
> - `attachRef` (đính kèm file trong email) chưa implement ở cả 2 transport (Graph lẫn Brevo) — nợ có sẵn từ trước, không phải do đợt này.
