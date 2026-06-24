# Phase 04 — Backlog go-live (P2)

> KHÔNG đụng tới khi đang chạy local. Đây là checklist chốt **trước khi đẩy lên prod self-host**. Gom ở đây để không quên, không làm sớm.

## Chặn cứng trước prod
- [ ] **Object store cho file** (`DEBT.md` dòng 1): PDF bài tập đang trên đĩa local API host → chuyển driver sang MinIO/S3 self-host; creds vào secret. Mất host = mất dữ liệu nếu không làm.
- [ ] **Secrets thật**: JWT_SECRET ≥32 ký tự ngẫu nhiên, CRM_LEAD_TOKEN, DB creds — ra khỏi `.env` mẫu, vào secret manager / env của server self-host.
- [ ] **CORS_ORIGINS** trỏ domain thật (env đã chuẩn bị sẵn comment).
- [ ] **Postgres backup/restore** định kỳ + thử restore 1 lần (runbook ngắn).

## Hardening nên có
- [ ] **Rate-limit đăng nhập** (chống brute-force) — Redis đã sẵn (`security-phase0-hardening-backlog.md`).
- [ ] **Lint rule cấm `prisma.*` ngoài `withRls`** — chốt footgun tenancy (hiện mọi router đều dùng withRls, nhưng chưa có rào tự động).
- [ ] **Receipt PDF** (`DEBT.md` dòng 2): nếu cần bản lưu trữ non-interactive → embed TTF Unicode qua @pdf-lib/fontkit. Hiện print-to-PDF HTML đủ vận hành.
- [ ] **Observability**: structured log + error tracking (Sentry self-host) + healthcheck endpoint cho 4 service.

## Vận hành self-host (khi triển khai)
- [ ] Prod compose/Dockerfile cho `api` + 3 app (hiện chỉ có `docker/docker-compose.dev.yml`).
- [ ] Reverse-proxy + TLS (Caddy/Nginx) trên server self-host.
- [ ] Smoke test trên URL thật: đăng nhập 4 vai trò, 1 luồng nghiệp vụ end-to-end mỗi app.

## Nguyên tắc
Mỗi mục chỉ "done" khi có bằng chứng thật trên server (chạy như người dùng), không phải "đã cấu hình". Bám DEBT.md — trả nợ trước khi mở cho người dùng thật.
