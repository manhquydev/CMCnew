---
title: "Brainstorm: xác minh live + chốt policy dev auth cho dev/prod CI/CD split"
date: 2026-07-04
status: converged-ready-for-execution
relatedPlan: plans/260703-0052-dev-prod-cicd-environments/plan.md
supersedes: plans/reports/brainstorm-260704-1646-dev-prod-cicd-soak-gate-and-parallel-login-report.md
---

# Vấn đề

Tiếp nối brainstorm trước (soak gate + policy password/SSO song song). User cung cấp:
1. Quyết định bỏ qua chờ 48h đồng hồ, dựa trên bằng chứng thực tế.
2. SSH root credential thật vào VPS prod, cho phép wrangler login nếu cần, cho phép chủ động lấy
   Jenkins credential từ server.
3. Yêu cầu research sâu hơn cho câu hỏi dev-auth-policy thay vì chốt nhanh.

# Xác minh trực tiếp trên VPS (SSH thật, chỉ đọc, chưa đổi gì)

| Hạng mục | Kết quả |
|---|---|
| Hostname/whoami | `ubuntu-s-2vcpu-8gb-160gb-intel-sgp1`, root — đúng VPS mục tiêu, khớp mô tả "2 vCPU" trong plan |
| Soak OOM events (từ `2026-07-02T19:58:30Z`) | **0 sự kiện** (`docker events --filter event=oom`) |
| dmesg OOM/killed process | **0 dòng khớp** |
| Memory | 7.8GiB total, 5.3GiB available (2.4GiB used, 2.9GiB buff/cache) |
| Disk | 129GiB free / 154GiB (17% used) |
| Container mem usage | Cao nhất: Jenkins 48.8%/3GiB cap; còn lại đều <10% cap |
| Cloudflare (wrangler) | Đã login sẵn (`cmceduvn@gmail.com`), scope có `zone:read`+`ssl_certs:write` — không cần login lại |
| DNS `deverp`/`devlms` | Đã resolve qua Cloudflare, cùng edge IP với `erp.cmcvn.edu.vn` (đúng trạng thái plan mô tả — DNS ok, routing tách biệt chưa làm) |
| Jenkins | Credential tồn tại `/root/jenkins.env` (đã redact), service trả 200 ở `/login` |
| nginx hiện tại | Chỉ có `server_name erp.cmcvn.edu.vn hoc.cmcvn.edu.vn ci.cmcvn.edu.vn` — chưa có deverp/devlms, khớp plan |
| prod `.env.production` | `STAFF_PASSWORD_LOGIN=true` đã set (decision 0031); không set `SEED_MODE` (mặc định `full`) |

**Kết luận: soak đã sạch thật (không phải bỏ qua liều), 3 checkpoint con người đã đúng, hạ tầng
sẵn sàng để thực thi Phase 1-5.** Đã flip `plans/260703-0022-devops-tier1-hardening/plan.md`
`status: soaking` → `done` dựa trên bằng chứng trên, unblock plan `260703-0052`.

# Research: dev-auth-policy cho môi trường dev (câu hỏi cần đào sâu)

**Câu hỏi**: dev nên setup auth thế nào để vừa dễ debug/test, vừa không đi ngược mục tiêu ban đầu
của plan (test SSO parity thật)?

**Đã đọc `packages/db/src/seed.ts`**: script có sẵn 2 mode qua `SEED_MODE`:
- `bootstrap`: chỉ super_admin có password thật, còn lại random-unusable (mode "an toàn", pre-0031).
- `full` (**mặc định** khi không set `SEED_MODE`): MỌI staff account trong seed (`giao_vien`,
  `ke_toan`, `hr`, `sale`, `cskh`, `ctv_mkt`, 2 director) được gán `passwordHash` thật từ
  `SEED_SUPERADMIN_PASSWORD` — sẵn sàng login password ngay, không cần gọi `user.setPassword`.

**Xác nhận prod đang chạy `full` mode thật** (không set `SEED_MODE` trong `.env.production`) — tức
cơ chế này ĐÃ đang chạy sản xuất, không phải đề xuất mới, rủi ro đã được decision 0031 chấp nhận.

## 3 phương án cho dev

| # | Phương án | Ưu | Nhược |
|---|---|---|---|
| 1 | Dev dùng `bootstrap` mode (an toàn nhất, chỉ super_admin có password) | Bảo mật cao nhất, ép dùng SSO thật để test parity | Không giải quyết được vấn đề "dễ debug/test" user nêu — mọi persona test vẫn cần SSO thật (MFA-gated), khó tự động hoá E2E |
| 2 (khuyến nghị) | Dev để `SEED_MODE` mặc định (`full`) + `STAFF_PASSWORD_LOGIN=true` trong `.env.dev` | Zero code mới — dùng đúng cơ chế đang chạy prod; mọi persona test có password sẵn ngay từ lần seed đầu; **giải quyết trực tiếp 1 vấn đề thật vừa gặp trong phiên này** (E2E spec `teacher-nav-consolidation.spec.ts` fail vì môi trường test thiếu `STAFF_PASSWORD_LOGIN`); SSO vẫn chạy song song đầy đủ — Phase 5 vẫn test SSO parity thật như thiết kế ban đầu, password chỉ là lane phụ | Dev có security bar thấp hơn 1 chút so với "chỉ SSO" — chấp nhận được vì dev chỉ chứa dữ liệu synthetic (đã là quyết định sẵn có trong plan, "Data posture") |
| 3 | Dev seed KHÔNG password (như bootstrap) NHƯNG viết thêm script tự động gọi `user.setPassword` cho từng persona khi seed | Vẫn tận dụng cơ chế password reset chính thức | Việc thừa — Option 2 đã cho kết quả tương đương mà không cần code mới (vi phạm YAGNI) |

**Khuyến nghị: Phương án 2.** Lý do quyết định: (a) không mâu thuẫn mục tiêu SSO-parity gốc của
plan — SSO vẫn là đường chính, password chỉ thêm 1 lane phụ, đúng tinh thần decision 0031 ("chạy
song song", không thay thế); (b) zero code mới, chỉ 2 dòng config; (c) có bằng chứng cụ thể trong
chính phiên làm việc hôm nay rằng thiếu cấu hình này gây thất bại E2E thật.

**Áp dụng**: đã thêm vào `phase-02-dev-stack-configuration-and-data-isolation.md` bước 7 —
`STAFF_PASSWORD_LOGIN=true` + ghi chú để `SEED_MODE` mặc định.

# Quyết định cuối (từ user)

1. **Mức độ thực thi**: tự thực thi hết cả 5 phase live trên VPS, verify từng bước, giữ rollback.
2. **Dev auth**: đã chốt Phương án 2 (nghiên cứu trên) — kế thừa cơ chế `SEED_MODE=full` +
   `STAFF_PASSWORD_LOGIN=true`, không cần quyết định/code mới.
3. **Plan**: dùng lại plan `260703-0052` có sẵn (đã red-team+validate lần 1, 2026-07-03) — nhưng
   chạy `ck:plan red-team` + `ck:plan validate` thêm 1 lần nữa trước khi thực thi, do có thay đổi
   thật kể từ lần review đầu (decision 0031 mới xuất hiện sau đó, bằng chứng soak-cleared mới, thêm
   quyết định dev-auth mới vào Phase 2).

# Bước tiếp theo

Chạy `ck:plan red-team` + `ck:plan validate` trên `plans/260703-0052-dev-prod-cicd-environments/plan.md`
(đã cập nhật Phase 2 + trạng thái blocking). Sau khi pass, thực thi Phase 1→5 tuần tự, live trên VPS,
verify từng bước trước khi qua phase kế.

# Câu hỏi chưa giải quyết

- Không còn — cả 3 điểm nghẽn trước đó đã được xác nhận/quyết định trong phiên này.
