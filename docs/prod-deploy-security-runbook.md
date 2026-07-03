# Prod Deployment & Security Runbook — CMCnew

Mục đích: checklist đầy đủ để đưa CMCnew lên production an toàn, **không sót việc**. Chạy theo thứ tự.
Stack: docker-compose (postgres, redis, api, admin, lms, nginx) with resource limits + origin TLS cert. Single public origin qua nginx.

> Trạng thái code security: các finding HIGH + security medium từ audit đã đóng (xem
> `plans/260627-2229-prod-security-readiness/plan.md`). Runbook này lo phần **hạ tầng + cấu hình + vận hành**.

---

## 0. Tiền đề
- Server Linux có Docker + docker compose v2.
- Domain trỏ về server: `erp.cmcvn.edu.vn`.
- Đã tạo Entra app (M365) + Redirect URI prod `https://erp.cmcvn.edu.vn/api/auth/sso/callback`.
- Đã tạo các MS account nhân sự (super_admin + 2 GĐ + ...) trên M365 admin center.

## 1. Secrets — `.env.production` (KHÔNG commit)
Copy `.env.production.example` → `.env.production`, điền:

```
# DB
DB_USER=cmc
DB_PASSWORD=<random mạnh>
DB_NAME=cmc
DB_APP_PASSWORD=<random mạnh — đặt SAU bước 4>
# Auth
JWT_SECRET=<openssl rand -hex 32>
COOKIE_SECURE=true                 # BẮT BUỘC khi có HTTPS
# Public origin (email links + CORS)
CORS_ORIGINS=https://erp.cmcvn.edu.vn
ADMIN_APP_ORIGIN=https://erp.cmcvn.edu.vn
NGINX_PORT=80                      # 443/TLS do reverse proxy hoặc nginx cert lo (xem mục 3)
# SSO Entra
ENTRA_TENANT_ID=<...>
ENTRA_CLIENT_ID=<...>
ENTRA_CLIENT_SECRET=<...>
ERP_SSO_REDIRECT_URI=https://erp.cmcvn.edu.vn/api/auth/sso/callback
STAFF_EMAIL_DOMAIN=cmcvn.edu.vn
# STAFF_PASSWORD_LOGIN=true — chạy song song với SSO (decision 0031). SSO vẫn là đường onboarding
# mặc định; đăng nhập mật khẩu chỉ dùng được cho tài khoản đã được super_admin gọi
# user.setPassword đặt mật khẩu — tài khoản chỉ qua SSO thì không có mật khẩu nào để đăng nhập.
STAFF_PASSWORD_LOGIN=true
# Graph email (M365 staff notifications)
GRAPH_SENDER_NOTIFY=<mailbox>
GRAPH_SENDER_PAYROLL=<mailbox>
GRAPH_SENDER_HR=<mailbox>
# Brevo email (external/parent mail — inert if unset)
BREVO_API_KEY=<optional — set only if routing to Brevo>
BREVO_SENDER_EMAIL=<optional — sender addr for Brevo>
# Seed
SEED_SUPERADMIN_EMAIL=admin@cmcvn.edu.vn
SEED_SUPERADMIN_PASSWORD=<random mạnh — break-glass; KHÔNG để mặc định>
```

Kiểm tra: `.env*` đã gitignored (đã verify, 0 secret committed).

## 2. Build + DB init (lần đầu)
```
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm api-migrate --build
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm api-seed   # bootstrap: chỉ HQ + admin@cmcvn.edu.vn
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

**Resource limits:** tất cả 9 service đã cấu hình limit trong `docker-compose.prod.tls.yml` (postgres/api: 1GiB/0.75cpu, redis: 256MiB/0.25cpu, nginx/admin/lms/certbot: 128MiB/0.25cpu, api-migrate/api-seed: 768MiB/0.5cpu). Cài đặt cho VPS 2vCPU/7.8GiB với Jenkins reservation 3GiB/1.5cpu.

## 3. TLS / HTTPS (BẮT BUỘC trước khi mở cho người dùng)
Hai lựa chọn:
- **A. Reverse proxy ngoài (khuyến nghị):** Cloudflare Tunnel (hoặc Caddy/Traefik) terminate TLS, forward về nginx:80. Đơn giản, auto-renew cert. **Origin TLS:** chạy `scripts/ensure-origin-cert.sh` (idempotent helper, tạo self-signed cert nếu chưa có, được gọi tự động từ `Jenkinsfile` deploy stage). Cert được mount vào nginx/api nếu cần.
- **B. nginx tự terminate:** thêm block `listen 443 ssl` + cert (Let's Encrypt certbot via `scripts/prod-tls-bootstrap.sh`) vào `docker/nginx.conf`, mount cert, map cổng 443. Khi đó **bật HSTS** (hiện comment ở `nginx.conf:23`). Certbot service trong `docker-compose.prod.tls.yml` gated behind `--profile le` (dormant by default).

Sau khi có TLS: đảm bảo `COOKIE_SECURE=true` (mục 1) — nếu không, browser drop cookie Secure / hoặc cookie không-Secure trên HTTPS bị cảnh báo.

## 4. Đổi mật khẩu `cmc_app` (sau migrate)
Migration tạo role `cmc_app` với mật khẩu mặc định `cmc_app`. ĐỔI ngay:
```
docker exec -it <postgres-container> psql -U cmc -d cmc \
  -c "ALTER ROLE cmc_app PASSWORD '<DB_APP_PASSWORD mới>';"
```
Cập nhật `DB_APP_PASSWORD` trong `.env.production` rồi `up -d --force-recreate api`.

## 5. Backup DB + blob stores

`scripts/backup-db.sh` dump DB (plain-SQL `pg_dump --clean --if-exists | gzip`, qua `docker exec` vì
postgres prod không mở port host) **và** tar 2 thư mục blob local-disk mà các dòng DB tham chiếu
(`.data/pdf` — `exercise.basePdfRef`; `.data/session-photos` — ảnh minh chứng buổi học). Restore
dùng `scripts/db-restore.sh` — CÙNG định dạng plain-SQL (không dùng `pg_restore`).

### Cài cron (VPS, [operator-assisted])
```bash
crontab -e
# thêm dòng (02:00 hằng ngày, log ra /var/log, ENV_FILE trỏ .env.production thật):
0 2 * * *  ENV_FILE=/root/cmcnew/.env.production BACKUP_DIR=/root/cmcnew/backups \
  PDF_STORE_DIR=/root/cmcnew/.data/pdf SESSION_PHOTO_STORE_DIR=/root/cmcnew/.data/session-photos \
  /root/cmcnew/scripts/backup-db.sh >> /var/log/cmc-backup.log 2>&1
```
Rotate `/var/log/cmc-backup.log` qua `logrotate` (weekly, keep 8) nếu chưa có entry chung.

`RETENTION_DAYS` (mặc định 14) prune cả `cmc-*.sql.gz` lẫn `cmc-blobs-*.tar.gz` cùng lúc.

### Restore drill (định kỳ, [operator-assisted] — KHÔNG BAO GIỜ chạy vào DB `cmc` thật)
```bash
# 1) Tạo DB scratch một lần:
docker exec -e PGPASSWORD=$DB_PASSWORD cmcnew-prod-postgres-1 \
  psql -U cmc -d postgres -c "CREATE DATABASE cmc_drill OWNER cmc;"

# 2) Restore bản backup mới nhất (DB + blobs) vào DB scratch + thư mục scratch:
DB_PASSWORD=*** PDF_STORE_DIR=./drill-data/pdf SESSION_PHOTO_STORE_DIR=./drill-data/session-photos \
  ./scripts/db-restore.sh ./backups/cmc-<stamp>.sql.gz ./backups/cmc-blobs-<stamp>.tar.gz cmc_drill

# 3) Kiểm tra: đếm row 1 bảng biết trước + đếm file blob + mở thử 1 PDF/ảnh:
docker exec -e PGPASSWORD=$DB_PASSWORD cmcnew-prod-postgres-1 \
  psql -U cmc -d cmc_drill -c "SELECT count(*) FROM \"Student\";"
find ./drill-data -type f | wc -l

# 4) Dọn dẹp DB scratch sau khi ghi nhận kết quả:
docker exec -e PGPASSWORD=$DB_PASSWORD cmcnew-prod-postgres-1 \
  psql -U cmc -d postgres -c "DROP DATABASE cmc_drill;"
rm -rf ./drill-data
```
Ghi kết quả vào `docs/ops/restore-drill-YYMMDD.md` (copy từ file mẫu, đổi tên theo ngày chạy).

## 6. Verify sau deploy (smoke)
```
curl -sI https://erp.cmcvn.edu.vn/api/health            # 200
curl -s -o /dev/null -w '%{http_code}' https://erp.cmcvn.edu.vn/api/auth/sso/login   # 302 → login.microsoftonline.com
```
- Đăng nhập `admin@cmcvn.edu.vn` qua SSO → vào được (super_admin).
- Tạo 2 GĐ + nhân sự qua UI (email = email M365). Họ nhận thư mời → đăng nhập SSO.
- Thử password-login 1 nhân sự → phải bị chặn (fail-closed, chỉ super_admin break-glass).

## 7. Lưu ý vận hành (QUAN TRỌNG)
- **Lockout pre-SSO:** nếu deploy mà chưa wire đủ ENTRA_* → SSO 503; lúc đó CHỈ `admin@cmcvn.edu.vn` (break-glass password) đăng nhập được. Wire SSO xong nhân sự mới vào được. Đây là hành vi cố ý (fail-closed), không phải lỗi.
- **Email transport:** riêng staff → Graph (M365); parents/external → Brevo. Graph config (GRAPH_SENDER_*) bắt buộc; Brevo (BREVO_API_KEY, BREVO_SENDER_EMAIL) tùy chọn — nếu không set, Brevo queue tích chập nhưng không gửi (inert). Nếu deploy mà Brevo chưa config → OTP/parent-notification queue nhưng không deliver.
- Mật khẩu break-glass `SEED_SUPERADMIN_PASSWORD`: cất nơi an toàn, đổi định kỳ.

## 8. Còn lại trước "prod hoàn chỉnh" (tracked trong plan)
- Phase A code: leadIngest per-IP rate-limit (A1); attendance enrollment/cancelled guards (A7).
- Quyết định product: certificate ràng FinalGrade.passed? (A6); passMark từ template thay client? (A8).
- Defense-in-depth (low): SSO nonce (A10) — PKCE+state đã đủ CSRF.
- Dependency: vuln npm hiện chỉ ở vitest/vite (dev-only, ngoài image prod) — theo dõi update.
- CI/CD: Jenkins (GH Actions chặn billing) — dựng sau.
