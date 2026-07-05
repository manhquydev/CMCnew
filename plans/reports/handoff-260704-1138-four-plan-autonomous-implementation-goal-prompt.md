---
title: "Handoff prompt — autonomous sequential implementation of the 4 plans (A→B→C→D)"
date: 2026-07-04
type: handoff-prompt
purpose: paste the block below into a fresh session as the /goal argument
source_plans:
  - plans/260704-1034-ux-correctness-quickfixes/
  - plans/260704-1034-datetime-picker-rollout/
  - plans/260704-1034-student-account-phone-identity-password/
  - plans/260704-1034-nav-module-subtab-ia/
context_reports:
  - plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
  - plans/reports/validate-260704-1120-four-plan-redteam-outcomes-and-final-state-report.md
---

## How to use

Open a fresh session in `D:\project\CMCnew`, then run `/goal` with the block below as its
argument (paste the whole thing). The goal hook will keep the session working until all 4 plans
are implemented, reviewed, tested, audited, fixed, committed, pushed, and PR-opened.

---

## THE GOAL PROMPT (copy from here to the end)

Triển khai TUẦN TỰ 4 plan đã được red-team + chuẩn hóa, theo thứ tự A → B → C → D, HOÀN TOÀN TỰ ĐỘNG, tuân thủ harness. Mỗi phase chạy đủ vòng **Implement → Review → Test → Audit → Fix → Commit**. Không dừng hỏi tôi giữa chừng — mọi quyết định thiết kế đã chốt + red-team xong (ghi trong plan). Chỉ DỪNG nếu gặp blocker thật (mâu thuẫn thiết kế, gate fail không tự sửa được, hoặc điều plan thực sự chưa quyết). Sau MỖI plan hoàn tất: push + mở PR + post tóm tắt ngắn cho tôi rồi tự đi tiếp plan kế.

### Nguồn sự thật (ĐỌC trước khi bắt đầu mỗi plan)
- Bối cảnh tổng: `plans/reports/validate-260704-1120-four-plan-redteam-outcomes-and-final-state-report.md` + `plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md`.
- 4 plan (đọc plan.md + tất cả phase file + decisions/ của plan trước khi code plan đó):
  - **A** `plans/260704-1034-ux-correctness-quickfixes/` (1 phase, 3 fix — thấp rủi ro, làm trước)
  - **B** `plans/260704-1034-datetime-picker-rollout/` (P0 helper + 4 phase theo nhóm màn hình)
  - **C** `plans/260704-1034-student-account-phone-identity-password/` (P0→P1→{P2‖P3}, HIGH-RISK auth)
  - **D** `plans/260704-1034-nav-module-subtab-ia/` (P0 design→P1→P2-4→P5, HIGH-RISK cross-cutting)
- Vì nhánh đã dịch chuyển sau khi plan được viết: **re-verify các file:line plan trích dẫn còn đúng** trước khi sửa (đọc code thật). KHÔNG tự suy diễn lại từ đầu — plan đã có thiết kế red-team-verified.

### Nhánh / PR (per-plan)
- Mỗi plan làm trên 1 nhánh feat RIÊNG, tách TỪ HEAD hiện tại của `feat/phase-d-facility-picker-and-stitch-wireframes` (nhánh này đã chứa toàn bộ re-skin + business logic mà plan được scout dựa trên — KHÔNG tách từ main). Ví dụ tên nhánh: `feat/plan-a-ux-quickfixes`, `feat/plan-b-datetime-pickers`, `feat/plan-c-student-phone-login`, `feat/plan-d-nav-module-ia`.
- Xong 1 plan → push nhánh → mở PR riêng cho plan đó (gh CLI). KHÔNG merge (main là PR-only + cần CI xanh; Jenkins là CI thật). Không commit thẳng main.
- Commit conventional theo phase (như plan re-skin đã làm), kèm footer `Claude-Session: <link>`.

### Vòng harness MỖI phase (giống hệt cách plan re-skin `260703-2351` đã chạy thành công)
1. **Implement** — dùng subagent (fullstack-developer) với prompt scoped theo phase file; hoặc tự làm nếu phase nhỏ.
2. **Review** — BẮT BUỘC spawn `code-reviewer` subagent, hammer đúng rủi ro của phase (đặc biệt: không đổi business logic ngoài phạm vi; giữ public contract; với C/D bám các invariant bảo mật bên dưới).
3. **Test** — chạy qua PowerShell (xem gotcha): `pnpm -w typecheck` + test liên quan (`pnpm --filter @cmc/ui test`, `pnpm --filter @cmc/admin test`, `pnpm --filter @cmc/api exec vitest run <file>`), ESLint file đã sửa. Với thay đổi UI: verify SỐNG bằng Playwright MCP (đăng nhập admin@cmc.local/ChangeMe!123, chụp ảnh màn hình liên quan) — typecheck pass KHÔNG đủ cho việc UI/nghiệp vụ.
4. **Audit** — `gitnexus_detect_changes({scope:'all'})` xác nhận scope khớp phase, không đụng file ngoài dự kiến.
5. **Fix** — sửa mọi finding review/test/audit; nếu code-reviewer tìm blocking → sửa + re-review trước khi commit.
6. **Commit** phase → refresh index (`npx gitnexus analyze --embeddings`; hook tự chạy sau commit, chạy tay nếu stale).

### INVARIANT KHÔNG ĐƯỢC ĐÁNH MẤT (red-team đã kê — bám sát)
- **Plan A**: status Select ở `class-workspace.tsx` = action-picker (Option B: `value={null}`, StatusBadge là nguồn sự thật, KHÔNG bind `value={batch.status}` vì `planned` không có trong data). Fix ngày dùng `dayjs(x).toDate()` không dùng `new Date(str)`.
- **Plan B**: test P0 helper BẮT BUỘC pin `TZ=Asia/Ho_Chi_Minh` trong vitest (không thì round-trip test vô nghĩa ở CI UTC). Tái dùng `toApiDate` (dayjs local). terms-panel + assessment-panel(:126 nhãn "L1") LOẠI khỏi scope. `shift-reg-detail-panel.tsx` thuộc Plan A không phải B.
- **Plan C (HIGH-RISK AUTH — invariant bảo mật lõi)**: login bằng SĐT phải trả **ticket chọn-hồ-sơ ký ngắn hạn**, TUYỆT ĐỐI KHÔNG mint cookie `kind:'parent'` (nếu không → biết SĐT + mật khẩu mặc định công khai `Cmc2026@` = chiếm cổng PH qua `guardian.profileUpdate` đổi email → hijack OTP). `enterChildProfile` verify ticket rồi mới set cookie `kind:'student'`. Test #11 (phone principal bị FORBIDDEN ở mọi `parentProcedure` mutation) + #12 (ticket không dùng được như LMS cookie) BẮT BUỘC. Dùng ticket approach (khuyến nghị) hơn `kind:'family'`. KHÔNG migration (tái dùng `ParentAccount.passwordHash`). Xử lý race `ParentAccount.phone` create bằng `ON CONFLICT DO NOTHING`/savepoint + test concurrent-sibling. Đồng bộ loginCode break-glass về dạng facility-prefixed. Test reset phải non-vacuous (set non-default → reset → mật khẩu cũ fail + `Cmc2026@` work + tokenVersion bump).
- **Plan D (HIGH-RISK)**: GIỮ URL phẳng `/{sectionKey}` (Option C — bảo toàn search deep-link + opportunity deep-link đã ship). DERIVE module membership TỪ `buildNavGroups` (1 nguồn sự thật, không tạo list `MODULES.subtabs` tay song song). 4 file `nav-*.test.ts` PHẢI pass NGUYÊN VẸN làm parity gate (KHÔNG viết lại `keysOf()`); chỉ THÊM guard mapping mới. Module chỉ-1-subtab hiển thị nhãn MODULE (đồng nhất, đã chốt). Nhánh KHÔNG merge tới khi P5 regression pass. KHÔNG sửa bug pre-existing hr-role 403 (`defaultSection` đưa hr vào section gate cấm) — đó là intake permissions riêng, chỉ cần SubTabBar chịu được `activeSection` ngoài tập visible.

### Gotcha môi trường (phiên này gặp — đề phòng)
- **Bash tool có thể lỗi "unexpected EOF" ở mọi lệnh** → dùng **PowerShell tool** cho git/typecheck/test/lint/gh. (pnpm resolve tới .ps1 nên `Start-Process "pnpm"` không chạy — dùng `Start-Process pwsh -ArgumentList "-Command","cd ...; pnpm --filter ... dev *> log"`.)
- **Dev stack** thường cần khởi động lại (máy restart chỉ auto-up stack prod): `docker compose -f docker/docker-compose.dev.yml up -d` (postgres-dev:5433, redis-dev:6380), rồi start dev server `@cmc/api` (4000) + `@cmc/admin` (5173). Kiểm tra `Invoke-WebRequest http://localhost:5173` + `:4000` trước khi verify UI.
- **CI**: Jenkins `ci.cmcvn.edu.vn` là tín hiệu thật; GH Actions "build" LUÔN đỏ (chặn billing) — bỏ qua, đừng coi là fail.
- **GitNexus**: refresh sau mỗi commit (`npx gitnexus analyze --embeddings`).
- Tuân thủ AGENTS.md: intake classification + `harness-cli trace`/`story`/`decision` (Plan C/D high-risk cần decision doc — đã có sẵn 0032 cho C; ghi decision cho D nếu behavior/authorization thay đổi).

### Closeout MỖI plan (chạy SAU khi Implement → Review → Test → Audit → Fix/debug được xác nhận xong toàn bộ phase của plan đó)
Theo đúng thứ tự:
1. `/ck:journal` — ghi nhật ký kỹ thuật cho plan vừa xong (quyết định, bug thật tìm+sửa, cạm bẫy).
2. `/ck:docs:update` — đồng bộ docs `./docs` bị ảnh hưởng (chỉ khi thay đổi chạm hành vi user-visible / setup / commands / kiến trúc / public contract / bảo mật — Plan C/D chắc chắn cần; A/B cân nhắc). Đọc doc trước khi sửa, verify ngày/link/claim khớp thay đổi thật.
3. `/ck:watzup` — báo cáo handoff/tiến độ ngắn.
4. Cập nhật `plan.md` status → implemented, push nhánh, mở PR riêng, post tóm tắt cho tôi (đã làm gì, bug thật tìm+sửa, kết quả test, link PR).

### Thứ tự & kết thúc
- Làm A → B → C → D (rủi ro tăng dần). A/B/C độc lập; D làm cuối để rewrite routing hấp thụ trạng thái cuối.
- Sau cả 4: cập nhật memory (`four-plan-set-ux-auth-nav-authored` → implemented), báo cáo tổng.

## (Hết prompt — copy tới đây)
