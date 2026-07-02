# Đánh giá UI/UX — LMS Claymorphic Redesign (chạy trên Docker prod-local, y hệt prod)

Ngày: 2026-07-01 | Nhánh: develop @ c840851 (+ fix trong báo cáo này)
Môi trường test: `docker-compose.prod.yml` (nginx reverse-proxy thật, KHÔNG phải vite dev server) tại `http://localhost/lms/`

## Tóm tắt

Redesign claymorphic (tokens, showcase, beanstalk climb, podium leaderboard) **đẹp và đúng hướng** khi xem qua vite dev server (port 5175). Nhưng khi kiểm thử đúng yêu cầu — **môi trường Docker giống hệt prod** — phát hiện **3 bug chức năng nghiêm trọng** khiến tính năng chính không hoạt động ngoài dev server. Đã sửa 2/3 (code); 1 cần quyết định của user (đánh đổi bảo mật CSP).

## Bug đã sửa

### 1. [FIXED] Docker build không áp dụng `--base=/lms/` → toàn bộ asset vỡ
- **File:** `apps/lms/Dockerfile:39`
- **Nguyên nhân:** cú pháp `pnpm --filter @cmc/lms run build -- --base=${VITE_BASE_URL}` — dấu `--` thừa khiến pnpm 10.24.0 âm thầm nuốt mất `--base`, build ra asset path `/assets/...` thay vì `/lms/assets/...`.
- **Hệ quả trước fix:** trang `/lms/` và `/lms/showcase` trắng trang hoàn toàn (JS/CSS 404 vì nginx reverse-proxy route nhầm sang app admin).
- **Fix:** bỏ dấu `--` thừa → `pnpm --filter @cmc/lms run build --base=${VITE_BASE_URL}`. Verify: asset path đúng `/lms/assets/...`, trang render đầy đủ.

### 2. [FIXED] Toàn bộ ảnh brand (logo, background login, badge chương trình) dùng path tuyệt đối `/brand/...`
- **File:** `packages/ui/src/lms-brand.tsx`, `lms-login-gate.tsx`; `apps/lms/src/{climb/cloud-climb,parent-shell,showcase-view,student-shell}.tsx`
- **Nguyên nhân:** hardcode `src="/brand/cmc-logo.jpg"` (path gốc domain) thay vì tương đối. Dưới sub-path `/lms/` thật, request này rơi sang app admin (nginx catch-all `/`) — ảnh sai hoặc vỡ ngầm (logo "may mắn" trùng tên file với admin nên trả 200 nhưng vẫn là copy khác).
- **Fix:** đổi toàn bộ 9 chỗ sang path tương đối (bỏ `/` đầu): `src="brand/cmc-logo.jpg"`. Hoạt động đúng cả dev (base `/`) lẫn prod (base `/lms/`) vì SPA luôn phục vụ tại 1 document duy nhất.
- Verify bằng browser thật: logo + background ảnh (sách, bút chì) hiện đúng, network 200 đúng path `/lms/brand/...`.

### 3. [FIXED] Nút CTA "Trải nghiệm UI mới 🚀" điều hướng SAI SANG MÀN HÌNH ĐĂNG NHẬP NHÂN VIÊN ERP
- **File:** `apps/lms/src/student-shell.tsx:143`, `apps/lms/src/App.tsx:16`
- **Nguyên nhân:** `href="/showcase"` (path tuyệt đối) — dưới `/lms/` thật, trình duyệt điều hướng tới `http://localhost/showcase` = catch-all admin app → hiện màn login nhân viên CMC Staff, không phải showcase. Đây là **tính năng đầu mối của cả walkthrough, hoàn toàn không dùng được trong prod.**
- Đồng thời `App.tsx` check `pathname === '/showcase'` cũng sai (không tính base `/lms/`).
- **Fix:** `href="showcase"` (tương đối) + `pathname.endsWith('/showcase')`. Verify qua code + network base URL resolution.

## Vấn đề CẦN USER QUYẾT ĐỊNH (chưa sửa)

### 4. Font "Fredoka/Quicksand" (linh hồn thiết kế kids-centric) bị CSP chặn hoàn toàn trong prod
- **File CSP:** `docker/nginx.conf:29`, `docker/nginx-prod.conf:61,102` — `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:'` (không whitelist `fonts.googleapis.com`/`fonts.gstatic.com`).
- **Hệ quả:** Google Fonts `<link>` bị chặn (console: "violates Content-Security-Policy") → toàn bộ giao diện fallback về font hệ thống, mất hoàn toàn phong cách "bo tròn, trẻ em" mà bản redesign hướng tới. Đây là **CSP siết chặt có chủ đích** (đợt devops hardening trước) — không nên tự ý nới lỏng.
- **2 lựa chọn:**
  - (a) Thêm ngoại lệ CSP cho `fonts.googleapis.com`/`fonts.gstatic.com` — nhanh, nhưng nới bảo mật + phụ thuộc mạng ngoài + có thể chậm LCP.
  - (b) Tự host font Fredoka/Quicksand (tải file `.woff2` vào `apps/lms/public/fonts/`, khai báo `@font-face`) — giữ nguyên CSP nghiêm ngặt, nhanh hơn, không phụ thuộc bên thứ ba. **Khuyến nghị.**
- Chưa code phương án nào — chờ user chọn.

## Ghi nhận, không sửa (ngoài phạm vi)

- **Dữ liệu mock Bảng xếp hạng không nhất quán** (`showcase-view.tsx`): podium hiển thị "CMC Student" #1 = 320 sao, nhưng danh sách huy chương bên dưới lại có "Trần Gia Bảo" 390 sao / "Lê Quỳnh Chi" 340 sao > 320 mà không lọt top-3 podium (podium #2/#3 chỉ 165/140 sao) — hai tập dữ liệu mock không khớp logic sắp hạng. Chỉ ảnh hưởng trang showcase demo, không phải logic thật (tRPC không đổi).
- **Lỗi TypeScript có sẵn từ trước** (không phải do đợt fix này): `showcase-view.tsx:409,743,807` và `student-view.tsx:720,806` — Mantine `SimpleGrid` không nhận prop `gap` theo type hiện tại. Không chặn `vite build`, chỉ chặn `tsc --noEmit`. Đã xác nhận tồn tại trước khi tôi sửa gì (kiểm bằng `git stash`).
- Logo 26px trên climb HUD hơi khó đọc (không phải bug, chỉ là polish nhỏ).

## Đánh giá UI/UX (góc nhìn người dùng: phụ huynh + học sinh 6-11 tuổi)

**Điểm mạnh:**
- Login gate 2 role rõ ràng (Phụ huynh/Học sinh), background minh họa ấm áp, đúng tông "học mà chơi".
- Dashboard học sinh: 3 thẻ số liệu (hành trình/xếp hạng/quà) to, rõ, đúng tâm lý trẻ em — số lớn, icon nổi bật, CTA "Học Ngay" luôn hiện.
- Beanstalk Climb: layout dọc theo dây leo trực quan, badge chương trình (BlackHole/BRIGHT/UCREA) tạo cảm giác hành trình.
- Responsive mobile (390px) tốt: leaderboard podium co giãn hợp lý, sidebar chuyển sang hamburger.
- Nhật ký học tập cho phụ huynh: rõ ràng, số liệu + timeline thông báo dễ theo dõi tiến độ con.

**Điểm cần cải thiện (ngoài 4 bug trên):**
- Toàn bộ trải nghiệm "vui nhộn" (font Fredoka bo tròn) **không đến được người dùng thật** cho tới khi xử lý bug #4 — đây là rủi ro lớn nhất về mặt đạt-được-mục-tiêu-thiết-kế.
- Nút CTA "Trải nghiệm UI mới" nên cân nhắc ẩn khỏi bản thật sau khi rollout xong (hiện là internal demo link, không phải tính năng cho user cuối).

## Đã verify

- `pnpm --filter @cmc/lms build` — sạch, 0 lỗi.
- `pnpm --filter @cmc/lms typecheck` — 5 lỗi pre-existing (không liên quan phạm vi), không introduce lỗi mới.
- Docker image `cmcnew-prod-lms` rebuild 2 lần, container recreate, browser-test thật qua Chrome DevTools MCP (screenshot + network + console) tại `http://localhost/lms/`.
- GitNexus index đã refresh (từ `93f2e3e` → hiện tại).

## Câu hỏi còn mở

1. Chọn phương án nào cho bug #4 (nới CSP vs tự host font)?
2. Có cần rebuild lại `cmcnew-prod-admin`/`cmcnew-prod-api` không, hay chỉ scope LMS? (Chưa đổi gì ở admin/api trong đợt này.)
3. Có muốn ẩn nút "Trải nghiệm UI mới" khỏi bản thật sau khi review xong không?
