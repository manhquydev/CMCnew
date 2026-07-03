# Báo cáo tình trạng: Đợt triển khai autonomous 3-plan (devops + email)

**Ngày**: 2026-07-03
**Phiên**: autonomous, tiếp nối từ memory `autonomous-devops-email-rollout-setup-260703`
**Nhánh làm việc**: `devops/tier1-hardening`, `email/brevo-external-routing`, `fix/jenkins-migrate-stale-image` (đều đã merge `main`)

## Tóm tắt

Phiên này thực thi tự động 3 plan đã được scout → research → plan → red-team → validate xong từ phiên trước. Kết quả: **2/3 plan đã ship prod, plan thứ 3 bị block đúng theo thiết kế (chờ soak + người thật)**. Ngoài ra, trong lúc verify deploy, phiên tự phát hiện và sửa **1 bug production thật** không nằm trong phạm vi 3 plan gốc.

## Trạng thái từng plan

### 1. DevOps Tier-1 Hardening — ✅ LIVE, đang soak 48h

PR #16 → merge `main` @ `bd890fb`. 3 hạng mục:
- **TLS**: cert self-signed tự sinh + tự verify mỗi lần deploy (`scripts/ensure-origin-cert.sh`), không cần bootstrap tay nữa.
- **Resource limits**: cả 9 service prod đều có `deploy.resources`, tính theo capacity thật của VPS (2 vCPU / 7.8 GiB).
- **CI gate**: Jenkins publish check `CMCnew CI` lên GitHub PR — **chỉ report-only**, chưa bật required-check vì check-run không post lên GitHub được ổn định (nguyên nhân gốc: `gitHubPullRequestDiscovery` build ephemeral merge SHA thay vì SHA thật — đã sửa 1 phần, vẫn còn lỗi chưa dứt điểm).

Soak 48h bắt đầu `2026-07-02T19:58:30Z`, cần chạy đến `~2026-07-04T19:58:30Z`. Kiểm tra định kỳ mỗi giờ: không OOM, container đều dưới xa memory ceiling, prod health ổn định.

### 2. Email Brevo External Routing — ✅ SHIPPED, inert

PR #17 → merge `main` @ `ed10663`. Vấn đề gốc: M365 tenant bị Microsoft chặn reputation (`550 5.7.708`) khi gửi email ra ngoài tenant — email cho phụ huynh (kể cả mã OTP đăng nhập LMS) im lặng gửi thất bại.

Giải pháp: 2 kênh gửi song song — Graph cho nhân viên nội bộ, **Brevo** cho người ngoài (phụ huynh), routing tự động theo domain. Đã sửa cả đường OTP đăng nhập LMS phụ huynh (trước đây hardcode Graph, bỏ qua outbox hoàn toàn).

**Ship ở trạng thái inert** — biến `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` để trống trên prod, email cứ hàng đợi chứ không gửi thật, chờ operator (không có quyền truy cập Brevo dashboard trong phiên này) cấu hình sender + DKIM.

549 integration test pass, migration đã apply + verify trên prod thật.

### 3. Dev/Prod CI/CD Split — ⬜ CHƯA BẮT ĐẦU (đúng thiết kế)

Chưa động vào — theo đúng thứ tự đã chốt: phải chờ plan #1 soak 48h xong. Ngoài ra plan này còn có **4 việc chỉ người thật làm được** (không có credential trong repo): đăng ký Entra redirect URI, xác nhận Cloudflare SSL mode + Origin Cert, lấy Entra client secret cho dev app, đăng nhập SSO qua trình duyệt thật (MFA).

## Phát hiện ngoài kế hoạch: bug production thật

Khi verify PR #17 deploy xong, phát hiện container API đã chạy code mới (kỳ vọng cột `EmailOutbox.transport`) nhưng **database prod thiếu cột đó** — dù Jenkins báo build xanh và log "all migrations applied".

**Nguyên nhân**: `Jenkinsfile` chạy `docker compose --profile migrate run --rm api-migrate` **không có flag `--build`** → âm thầm dùng lại Docker image cache cũ từ lần deploy trước thay vì rebuild theo commit hiện tại. Migration nào đi kèm cùng commit với thay đổi khác sẽ bị bỏ sót mà Jenkins không báo lỗi gì.

**Xử lý ngay**: chạy tay `prisma migrate deploy` bên trong container đã rebuild → áp dụng **21 migration tồn đọng từ 2026-06-30** — xác nhận lỗi này đã âm thầm tích tụ nhiều ngày trước phiên này, không phải do phiên này gây ra. Không có sự cố người dùng thật (bắt kịp trước khi có code path nào chạm cột thiếu).

**Xử lý gốc**: PR #18 → merge `main` @ `6992659`, thêm `--build` vào lệnh migrate. Đã deploy-verify lại: lệnh migrate giờ rebuild đúng, migration count khớp giữa repo và DB (69/69).

Chi tiết đầy đủ: `docs/journals/260702-2100-jenkins-migrate-stale-image-fix.md`.

## Việc đã làm thêm ngoài code

- `/journal` — viết journal tổng kết phiên: `docs/journals/260703-0740-autonomous-session-3-shipped-pr-summary.md`.
- `/docs update` — cập nhật `docs/ARCHITECTURE.md`, `docs/prod-deploy-security-runbook.md`, `docs/codebase-summary.md` phản ánh cả 3 thay đổi.
- Viết lại `README.md` chi tiết, phản ánh đúng trạng thái hiện tại (trước đó README ghi ngày 2026-06-24, đã lỗi thời — nói "chưa có git remote", "CI chưa chạy thật" trong khi Jenkins đã chạy thật nhiều tuần).
- `harness-cli intake` (#61) + `harness-cli trace` (#113) ghi nhận công việc phiên này vào durable layer.
- 2 memory file cập nhật: `devops-tier1-hardening-execution-status.md` (chi tiết kỹ thuật + lesson-learned Jenkins), `MEMORY.md` (index).

## Câu hỏi còn mở

1. CI required-check (`CMCnew CI`) vẫn chưa post ổn định lên GitHub — cần điều tra sâu hơn plugin `github-checks` (có thể cần trait "Status Checks Properties" hoặc version khác). Không chặn công việc hiện tại nhưng cần làm trước khi bật `scripts/setup-github-required-check.sh`.
2. Brevo chưa có xác nhận sender/DKIM trên dashboard thật — cần operator làm trước khi email phụ huynh thật sự gửi được.
3. Soak 48h của plan #1 còn khoảng 44h tính đến lúc viết báo cáo này — plan #2 chưa thể bắt đầu.
