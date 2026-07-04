---
title: "Kết quả: merge PR #32 → develop, CI/CD dev deploy xanh, verify môi trường dev thật"
date: 2026-07-04
type: ci-merge-and-dev-env-verification
plan: plans/260703-0052-dev-prod-cicd-environments/plan.md
prs: [ "#32 (dev/prod split)", "#33 (fix CI smoke race)" ]
status: done — CI develop build SUCCESS, dev env verified functional
---

# Merge PR #32 + verify môi trường dev trên server

## 1. Kết quả 1 dòng

Merge PR #32 vào `develop` → Jenkins `cmcnew/develop` build **#12 SUCCESS** (lần đầu CI tự deploy
dev end-to-end) → dev env (`deverp`/`devlms`) chạy commit `dc63ed6`, test happy→edge đều PASS,
prod (`erp`/`hoc`) không đổi (`84ff0d22`). Tìm + sửa 1 race-condition CI thật giữa chừng.

## 2. CI/CD — diễn tiến (theo dõi sát)

| Build | Commit | Kết quả | Ghi chú |
|---|---|---|---|
| #10 | `fef78e3b` (merge #32) | **FAILURE** | Deploy dev THÀNH CÔNG nhưng Smoke(dev) fail |
| #11 | `fef78e3b` (stale index) | FAILURE | Build revision cũ (chưa index PR#33), lỗi giống #10 |
| #12 | `dc63ed6` (merge #33, có fix) | **SUCCESS** ✅ | Full pipeline xanh, dev deploy `dc63ed6` |

- Pipeline chạy đúng thứ tự: Lint+Typecheck → Integration → Build+Deploy(prod) *skipped (main-only)*
  → Build+Deploy(dev) → Smoke(dev).
- RAM suốt các build: 3.9–5.4 GiB available, **0 OOM**. Prod giữ `84ff0d22` xuyên suốt.
- Webhook: push `develop` KHÔNG auto-trigger build (phải trigger tay qua Jenkins API); có 1 lần
  scan trễ tự chạy #12. → runbook nên ghi: sau merge develop, verify build được kích hoạt.

## 3. Bug thật tìm + sửa (PR #33)

**Race condition ở Smoke(dev):** stage Build+Deploy(dev) recreate `dev-api` rồi Smoke(dev) chạy
`exec dev-api wget localhost:4000/health` ~2s sau khi container "Started" → `connection refused` vì
Node/Prisma còn trong `start_period` → build FAILURE dù deploy tốt.

**Fix:** thêm vòng chờ `dev-api` healthy (tối đa 40×3s) trước khi reload nginx + smoke. Jenkinsfile
pass declarative-linter. Build #12 xác nhận xanh. (Prod stage KHÔNG đụng — nó vốn chạy tốt, deploy
dài hơn nên không gặp race.)

## 4. Verify môi trường dev thật (happy → edge)

| # | Test | Kết quả |
|---|---|---|
| Happy | `/api/health` deverp+devlms | `dc63ed6`, ok:true |
| Happy | Password login `ketoan@cmc.local` | 200, cookie `cmc.dev.session` (HttpOnly/Secure/Lax), user "Kế Toán"/`ke_toan` |
| Happy | `auth.me` có cookie | trả đúng user (session hợp lệ) |
| Happy | SSO start `/api/auth/sso/login` | 302 → Entra, redirect_uri = `deverp.../callback` |
| Edge | `auth.me` không cookie | `data:null` (chưa auth) |
| Edge | Sai mật khẩu | 401 "Sai email hoặc mật khẩu" |
| Edge | User không tồn tại | 401 message y hệt (không lộ user enumeration) |
| Edge | Cookie name | `cmc.dev.session` (≠ prod `cmc.session`) — không đụng nhau |
| Edge | Dev DB isolation | `dev-postgres`/`dev-redis` chỉ trên `cmcnew-dev_default`, 0 host port, TCP 5432 tới IP public = refused |
| Edge | Prod isolation | `erp`/`hoc` giữ `84ff0d22` suốt quá trình |
| Note | Rate limiter | 7 lần login sai → đều 401 (ngưỡng limiter > 7; đường reject bad-cred hoạt động đúng) |

## 5. Trạng thái cuối

- Stacks: `cmcnew-prod`(7) + `cmcnew-dev`(5) + `cmcnew-jenkins`(1) đều running.
- Dev stack giờ do **Jenkins sở hữu** (deploy từ workspace `cmcnew_develop`, project `cmcnew-dev`,
  volume giữ nguyên) — thay cho bản dựng thủ công trước đó.
- CI/CD split đã **được chứng minh end-to-end**: push `develop` → build → deploy dev tự động → smoke xanh.

## Câu hỏi chưa giải quyết

- Webhook GitHub→Jenkins cho nhánh `develop` chưa auto-trigger — có muốn tôi kiểm tra/wiring lại
  webhook (để push develop tự build, khỏi trigger tay) không?
- Rate limiter ngưỡng > 7 lần/IP+email — có muốn xác nhận/điều chỉnh ngưỡng không?
- Bước human-only còn lại: login SSO tương tác thật (Entra MFA) trên `deverp` (đã verify tới 302).
- 2 nhánh đã merge (`devops/dev-prod-cicd-split`, `devops/fix-dev-smoke-health-wait`) — xoá remote không?
