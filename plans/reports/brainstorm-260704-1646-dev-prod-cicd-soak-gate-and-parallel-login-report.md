---
title: "Brainstorm: bắt đầu dev/prod CI/CD split khi soak gate chưa xong + xác nhận policy password/SSO song song cho dev"
date: 2026-07-04
status: proposed-pending-confirmation
relatedPlan: plans/260703-0052-dev-prod-cicd-environments/plan.md
---

# Vấn đề

User báo 3/4 checkpoint con người của plan `260703-0052-dev-prod-cicd-environments` đã xong
(Entra redirect URI, Cloudflare Origin Cert PEM, Entra client secret) và muốn triển khai ngay.
Đồng thời mô tả 1 chính sách mới: cho phép password login + SSO chạy song song (không chỉ SSO)
để hỗ trợ vận hành/debug/test dễ hơn giai đoạn đầu.

# Rà soát hiện trạng (đã xác nhận qua code/git, không phải giả định)

1. **Chưa có dòng code nào của plan 0052 tồn tại**: không có `docker-compose.dev.tls.yml`,
   không có host `deverp`/`devlms` trong `nginx-prod.conf`, `Jenkinsfile` chưa có nhánh `develop`,
   chưa có `.env.dev.example`, chưa có `docs/decisions/0020-*`.
2. **3 checkpoint con người khớp đúng yêu cầu plan Phase 1**: redirect URI
   `https://deverp.cmcvn.edu.vn/api/auth/sso/callback` đúng; Cloudflare "Full" + Origin Cert PEM
   đúng chiến lược đã khoá bởi decision 0029 (không phải "Full Strict"); client secret đúng vị trí
   cần cho Phase 2.
3. **Chặn thật KHÔNG phải 3 checkpoint trên** — plan 0052 `blockedBy: 260703-0022-devops-tier1-hardening`.
   Soak 48h của 0022 bắt đầu `2026-07-02T19:58:30Z`, cần chạy tới `~2026-07-04T19:58:30Z`. Tại thời
   điểm brainstorm (`2026-07-04T09:4x UTC`), còn thiếu **~10 giờ**. Plan file `0022` vẫn ghi
   `status: soaking`, chưa `done`.
   - Tách 2 phần của "blockedBy": (a) code nền tảng của 0022 (Jenkinsfile TLS reconciliation, CI
     merge gate) — **đã merge vào `main`** (PR #16, xác nhận qua `git merge-base`), phần này KHÔNG
     phụ thuộc kỹ thuật vào soak; (b) cửa sổ soak an toàn (theo dõi OOM/tài nguyên 48h trước khi
     tuyên bố ổn định) — **chưa xong**, đây là phần thật sự chặn việc deploy CUTOVER thật lên VPS.
4. **Chính sách "password + SSO song song" ĐÃ TỒN TẠI, không phải quyết định mới**: decision
   `docs/decisions/0031-staff-password-login-parallel-to-sso.md`, đã merge vào `main` (PR #25,
   phiên trước). `STAFF_PASSWORD_LOGIN=true` set permanent ở prod; `super_admin` có
   `user.setPassword` để set/reset password bất kỳ staff nào; SSO vẫn là đường onboard mặc định;
   tài khoản chỉ-SSO (đa số) vẫn không có password khả dụng cho tới khi được set tường minh.
   Điều còn lại thật sự mở là: **có set `STAFF_PASSWORD_LOGIN=true` mặc định trong `.env.dev` sắp
   tạo (Phase 2 bước 7) hay không** — đây là 1 dòng cấu hình, không phải thay đổi code/quyết định.
5. **Không có SSH/Cloudflare API token nào sẵn trong phiên hiện tại** (`grep` xác nhận zero
   `CF_API_TOKEN` trong repo) — không thể tự thực thi live deploy/nginx reload/Jenkins CASC reload
   lên VPS từ phiên chat này.

# 3 câu hỏi đã đặt ra (chưa có phản hồi — user away >60s hai lần)

1. **Xử lý soak gate**: viết code trước (không đụng prod), giữ lại bước deploy/cutover thật tới khi
   soak xong / đợi soak xong hẳn / bỏ qua gate làm full ngay.
2. **Ai thực thi deploy VPS thật**: tôi chuẩn bị code+runbook, user (hoặc phiên có SSH) tự chạy /
   cấp quyền SSH+CF token cho phiên này.
3. **Policy dev auth**: dev kế thừa y hệt decision 0031 của prod (`STAFF_PASSWORD_LOGIN=true` mặc
   định trong `.env.dev`) / dev cần khác — nêu cụ thể.

# Đề xuất mặc định (PROPOSED — CHƯA XÁC NHẬN, chưa code/deploy gì)

Theo đúng HARD-GATE của `/brainstorm` (không thực thi khi chưa có approval), đây là phương án tôi
khuyến nghị cho cả 3 câu, đóng vai trò placeholder chờ user xác nhận khi quay lại — **không có
hành động nào đã được thực hiện dựa trên các đề xuất này**:

1. **Soak gate**: viết code Phase 1-2 (decision doc `0020-*`, `docker-compose.dev.tls.yml`,
   `.env.dev.example`) và Phase 3-4 (nginx config, Jenkinsfile branch split) NGAY — các file này là
   thêm-mới/sửa cấu hình, không tự động deploy hay đụng prod đang chạy khi chỉ ở dạng file trong
   repo. Giữ lại toàn bộ bước "thật" (nginx reload trên VPS, Jenkins CASC reload, docker compose up
   trên VPS, cutover DNS/routing) tới khi soak xong (~10h nữa, ước ~00h giờ VN 2026-07-05) VÀ
   `plans/260703-0022-devops-tier1-hardening/plan.md`'s `status` được xác nhận chuyển `done`.
2. **Ai deploy VPS**: tôi chuẩn bị đủ code/config/runbook chính xác (đúng lệnh, đúng thứ tự) — user
   tự chạy trên VPS theo runbook, hoặc cấp SSH key + `CF_API_TOKEN` cho 1 phiên sau nếu muốn tôi tự
   thực thi và verify live.
3. **Dev auth policy**: set `STAFF_PASSWORD_LOGIN=true` mặc định trong `.env.dev.example` (kế thừa
   y hệt decision 0031 của prod) — không cần quyết định mới, chỉ 1 dòng cấu hình trong Phase 2.

# Bước tiếp theo

Khi user quay lại và xác nhận (hoặc điều chỉnh) 3 điểm trên, chuyển sang `/ck:plan` để lập plan
chi tiết theo phase (tái dùng 5 phase file đã có sẵn trong `plans/260703-0052-dev-prod-cicd-environments/`,
chỉ cập nhật theo phạm vi đã chốt — không cần viết plan mới từ đầu, plan cũ đã qua red-team +
validation đầy đủ, chỉ thiếu bước authoring/execute).

# Câu hỏi chưa giải quyết

- Xác nhận đáp án 3 câu hỏi trên (soak gate / ai deploy VPS / dev auth policy).
- Nếu chọn "cấp SSH/CF token cho phiên này" — cần user cung cấp thông tin đó trực tiếp (không tự
  tra cứu được từ repo).
