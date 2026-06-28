# Prod Deployment & Security Runbook — CMCnew

Mục đích: checklist đầy đủ để đưa CMCnew lên production an toàn, **không sót việc**. Chạy theo thứ tự.
Stack: docker-compose (postgres, redis, api, admin, lms, nginx). Single public origin qua nginx.

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
# Fail-closed: KHÔNG set STAFF_PASSWORD_LOGIN ở prod (chỉ super_admin break-glass)
# Graph email
GRAPH_SENDER_NOTIFY=<mailbox>
GRAPH_SENDER_PAYROLL=<mailbox>
GRAPH_SENDER_HR=<mailbox>
# Seed
SEED_SUPERADMIN_EMAIL=admin@cmcvn.edu.vn
SEED_SUPERADMIN_PASSWORD=<random mạnh — break-glass; KHÔNG để mặc định>
```

Kiểm tra: `.env*` đã gitignored (đã verify, 0 secret committed).

## 2. Build + DB init (lần đầu)
```
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d postgres redis
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm api-migrate
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm api-seed   # bootstrap: chỉ HQ + admin@cmcvn.edu.vn
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

## 3. TLS / HTTPS (BẮT BUỘC trước khi mở cho người dùng)
Hai lựa chọn:
- **A. Reverse proxy ngoài (khuyến nghị):** Caddy/Traefik/Cloudflare Tunnel terminate TLS, forward về nginx:80. Đơn giản, auto-renew cert.
- **B. nginx tự terminate:** thêm block `listen 443 ssl` + cert (Let's Encrypt certbot) vào `docker/nginx.conf`, mount cert, map cổng 443. Khi đó **bật HSTS** (hiện comment ở `nginx.conf:23`).

Sau khi có TLS: đảm bảo `COOKIE_SECURE=true` (mục 1) — nếu không, browser drop cookie Secure / hoặc cookie không-Secure trên HTTPS bị cảnh báo.

## 4. Đổi mật khẩu `cmc_app` (sau migrate)
Migration tạo role `cmc_app` với mật khẩu mặc định `cmc_app`. ĐỔI ngay:
```
docker exec -it <postgres-container> psql -U cmc -d cmc \
  -c "ALTER ROLE cmc_app PASSWORD '<DB_APP_PASSWORD mới>';"
```
Cập nhật `DB_APP_PASSWORD` trong `.env.production` rồi `up -d --force-recreate api`.

## 5. Backup DB
Dùng script `scripts/backup-db.sh` (cron hằng ngày). Hoặc snapshot volume `pgdata`. Test restore định kỳ.

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
- Email gửi qua Graph là no-op nếu thiếu GRAPH_SENDER_* → thư mời/OTP không đi. Wire đủ trước khi onboard.
- Mật khẩu break-glass `SEED_SUPERADMIN_PASSWORD`: cất nơi an toàn, đổi định kỳ.

## 8. Còn lại trước "prod hoàn chỉnh" (tracked trong plan)
- Phase A code: leadIngest per-IP rate-limit (A1); attendance enrollment/cancelled guards (A7).
- Quyết định product: certificate ràng FinalGrade.passed? (A6); passMark từ template thay client? (A8).
- Defense-in-depth (low): SSO nonce (A10) — PKCE+state đã đủ CSRF.
- Dependency: vuln npm hiện chỉ ở vitest/vite (dev-only, ngoài image prod) — theo dõi update.
- CI/CD: Jenkins (GH Actions chặn billing) — dựng sau.
