---
title: "Kết quả triển khai: Dev/Prod CI/CD split + real SSO (live trên VPS)"
date: 2026-07-04
type: implementation-results
plan: plans/260703-0052-dev-prod-cicd-environments/plan.md
decision: docs/decisions/0032-dev-prod-cicd-environment-split.md
branch: devops/dev-prod-cicd-split
pr: https://github.com/manhquydev/CMCnew/pull/32
status: implemented (chờ review PR + 1 bước human-only)
---

# Kết quả triển khai — Dev/Prod CI/CD split

## 1. Tóm tắt 1 dòng

Đã dựng môi trường **dev thứ 2** (`cmcnew-dev` → `deverp`/`devlms.cmcvn.edu.vn`) sống trên cùng VPS
prod, sau chung 1 edge nginx, DB/secret/cookie tách biệt; `develop`→dev, `main`→prod, PR chỉ
validate. Prod **không gián đoạn**. Toàn bộ 5 phase autonomous, mỗi phase đủ vòng harness.

## 2. Bằng chứng live (verified 2026-07-04)

| Route | /api/health commit | Ý nghĩa |
|---|---|---|
| `erp.cmcvn.edu.vn` | `84ff0d22` | prod, nguyên trạng |
| `hoc.cmcvn.edu.vn` | `84ff0d22` | prod, nguyên trạng |
| `deverp.cmcvn.edu.vn` | `8277022` (develop) | **dev stack mới** |
| `devlms.cmcvn.edu.vn` | `8277022` (develop) | **dev stack mới** |
| `ci.cmcvn.edu.vn` | HTTP 200 | Jenkins, nguyên trạng |

→ **Marker prod ≠ dev = chứng minh cutover thật.** Ngoài ra:
- `cmcnew-dev` chạy 5 container; `dev-postgres`/`dev-redis` cô lập trên `cmcnew-dev_default`
  (KHÔNG trên `cmcnew-edge`, KHÔNG publish host port → DB dev bất khả đạt từ edge/prod/internet).
- App tier dev (`dev-api`/`dev-admin`/`dev-lms`) reachable từ prod nginx qua alias
  `cmcnew-dev-*` trên `cmcnew-edge`.
- RAM ~5.9 GiB available, `dmesg` sạch (0 OOM), `COMPOSE_PARALLEL_LIMIT=1`.
- Prod không gián đoạn: nginx gắn edge bằng `docker network connect` (zero-downtime);
  đổi config luôn `nginx -t` + reload, không restart.

## 3. Việc đã làm theo phase (mỗi phase: Implement → Review → live → verify → audit → commit → trace)

| Phase | Nội dung | Commit |
|---|---|---|
| 1 | Safety baseline: baseline health, Cloudflare "Full" verify, decision 0032, xác nhận blockedBy 0022=done | `ac520e1` |
| 2 | `docker-compose.dev.tls.yml` + `.env.dev.example` + edge network + dev stack live (migrate/seed full) | `57187b3` |
| 3 | nginx dev vhosts (deverp/devlms) + cert SAN mở rộng 4 host; reload; cutover proven | `85d7e11` |
| 4 | Jenkinsfile branch split (develop→dev, main→prod, PR validate-only); linter PASS; jenkins mount `.env.dev` | `87a3bd3` |
| 5 | SSO parity (dev+prod redirect URI, host-only `cmc.sso_tx`); runbook + security runbook | `3c03ae8` |
| — | plan `status: implemented` + journal | `cf72b52`, +journal |

Harness trace: #120–124. PR: **#32** (chưa merge — chờ review người thật cho hạ tầng live).

## 4. Bug/gotcha thật tìm & sửa trong lúc chạy

1. **Landmine prod deploy (code-reviewer CRITICAL):** prod compose tham chiếu `cmcnew-edge`
   (external) nhưng không ai tạo → lần deploy `main` kế tiếp sẽ abort. Sửa: encode
   `docker network create cmcnew-edge 2>/dev/null || true` vào cả 2 deploy path.
2. **`cmc_app` bị xoá password:** nested SSH quoting làm `$DB_APP_PASSWORD` rỗng → role mất
   password (migrate/seed vẫn chạy vì dùng owner role). Sửa: heredoc remote script; proven bằng
   dev-api healthy.
3. **Windows CRLF phá bash trên VPS:** script `.sh` scp lên mang CRLF → `set -o pipefail` fail;
   sequence đã kịp xoá cert cũ trước khi script lỗi. Prod vẫn phục vụ từ cert in-memory của nginx;
   sửa: `sed -i 's/\r$//'` + regenerate cert 4-SAN.
4. **nginx cache IP upstream:** recreate container mà prod nginx proxy tới (dev app tier, hoặc
   Jenkins recreate → ci 502 tạm) → nginx trỏ IP cũ. Fix: `nginx -s reload` (zero-downtime), đã
   nhúng vào Jenkins dev deploy stage + runbook.
5. **`APP_COMMIT` reset khi recreate thủ công:** `up -d dev-api` không export `APP_COMMIT` →
   `/health` về `commit: "unknown"`. Jenkins luôn export; path thủ công cũng phải set.

## 5. Deviations (đều có chủ đích, đã ghi rõ)

- Decision đánh số **0032** (không phải "0020" như plan viết — 0020 đã bị `work-shift-manager-ownership` chiếm).
- Dev **dùng chung client secret** của Entra app (redirect URI/cookie/DB/origin đều dev-scoped riêng);
  đã validate non-interactive bằng `client_credentials`. Có thể thay secret dev riêng vào `.env.dev` sau nếu muốn siết chặt.
- Regenerate cert live an toàn vì Cloudflare "Full" không validate origin SAN.

## 6. Còn lại cần bạn (2 việc, đều là human-only theo đúng thiết kế)

1. **Xác nhận Cloudflare SSL mode = "Full"** trên dashboard 1 lần cuối (đã verify live bằng
   `openssl`; đây là bước nhìn dashboard cho chắc).
2. **Login SSO tương tác thật** trên `https://deverp.cmcvn.edu.vn` (Entra MFA trên trình duyệt) để
   hoàn tất callback + set cookie `cmc.dev.session`. Mọi thứ tới trước bước đó đã verify
   (SSO-start 302 → Entra với dev redirect URI + tx cookie host-only; prod SSO không ảnh hưởng).
   Checklist: `docs/dev-prod-cicd-runbook.md` → SSO redirect checklist.

## 7. Lưu ý về Jenkins CI

Hành vi CI thật (PR không deploy, `develop`→dev tự động) **chỉ kích hoạt sau khi PR #32 merge vào
`develop`** (Jenkins cần các stage dev + dev compose nằm trên nhánh đó). Jenkinsfile đã pass
declarative-linter; bản dựng dev thủ công (Phase 2/3) đã chứng minh stack dev deploy + phục vụ đúng.

## 8. Artefacts

- Code: `docker/docker-compose.dev.tls.yml`, `.env.dev.example`, sửa `docker-compose.prod.tls.yml`
  / `docker-compose.jenkins.yml` / `nginx-prod.conf` / `Jenkinsfile` / `ensure-origin-cert.sh` /
  `prod-server-deploy.sh` / `.gitignore`.
- Docs: `docs/dev-prod-cicd-runbook.md` (mới), `docs/prod-deploy-security-runbook.md` (cập nhật),
  `docs/decisions/0032-*.md`, journal `docs/journals/260704-1720-*.md`.
- VPS: backup rollback còn giữ (`nginx-prod.conf.bak.*`, `docker-compose.*.bak.*`); backup chứa
  secret (`.env.dev.bak.*`) + script scratch đã xoá.

## Câu hỏi chưa giải quyết

- Có muốn tạo **client secret Entra riêng cho dev** (thay vì dùng chung app) để siết blast-radius không?
- Sau merge PR #32, có muốn tôi trigger/verify 1 vòng Jenkins `develop` build thật để chốt CI proof không?
- Có cần thêm **badge "DEV"** hiển thị trên UI deverp/devlms (Phase 5 unresolved question) không?
