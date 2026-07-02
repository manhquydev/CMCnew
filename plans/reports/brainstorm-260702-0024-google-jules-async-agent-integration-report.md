# Brainstorm: Tích hợp Google Jules vào quy trình phát triển CMCnew

Date: 2026-07-02
Status: Design agreed, chưa triển khai (chờ /ck:plan)

## Vấn đề gốc (problem-first)

- **Tín hiệu ban đầu**: user đề xuất công cụ cụ thể (Jules) → theo problem-first inversion, cần giải nén ra vấn đề thật trước khi bàn khả thi.
- **Vấn đề thật đằng sau**: cần một cơ chế xử lý bug nhỏ/lặp lại khi không có mặt để chủ động code — hiện tại mọi việc code (kể cả bug nhỏ) đều cần user ngồi tương tác trực tiếp với Claude Code; không có đường "giao việc rồi đi làm chuyện khác, quay lại có PR sẵn để review".
- **Assumption cần test**: Jules có tương thích với governance hiện tại của repo (branch flow develop→main PR-only, CI 2 nguồn) không? Rủi ro nếu sai: cấp quyền ghi vào repo production cho 1 agent không hiểu tín hiệu CI hỗn hợp → PR rác hoặc vòng lặp tốn quota.
- **Evidence status**: Weak/None trước khi có báo cáo này — quyết định dựa trên đặc tính công bố của Jules + cấu trúc thật của repo, chưa có dữ liệu vận hành thật.

## Research summary

### Google Jules (nguồn: jules.google, developers.google.com/jules, blog.google, so sánh bên thứ 3 2025-2026)

- Cloud-only, async agent (Gemini 2.5-3 Pro): nhận task → clone repo vào VM riêng trên Google Cloud → tự sửa/tự test → mở PR. Không chạy local, không cần ngồi tương tác.
- Chỉ hỗ trợ GitHub (không GitLab). Xác thực qua OAuth tài khoản Google cá nhân (@gmail.com) — **chưa có gói tổ chức/kiểm soát admin cấp org**, chưa công bố chứng nhận bảo mật (SOC2/HIPAA), chưa rõ chính sách giữ dữ liệu.
- Trigger: web UI, GitHub Actions event (`google-labs-code/jules-invoke`), CLI `jules` (hỗ trợ Windows), API alpha.
- Giá: Free = 5 task/tháng, 3 task đồng thời. Pro $19.99/th = 75 task/ngày. Không cần CI của repo hoạt động để Jules tự chạy test trong VM của nó, nhưng **nó có đọc trạng thái check trên PR** để biết có cần tự sửa tiếp không.
- Giới hạn: ~768K token context, khó với file cực lớn/monorepo >1M file; free tier cạn nhanh; nhiều báo cáo timeout/quá tải khi traffic cao.
- SWE-bench ~51.8% (thấp hơn Claude Code ~80.8%) — định vị là "PR-driven async fixer" cho task quy mô vừa/nhỏ, không phải giải bài khó.

### CMCnew hiện trạng (đã verify trực tiếp qua code + `gh pr list`, KHÔNG chỉ dựa vào docs)

- Branch flow: `develop` là nhánh làm việc mặc định, `main` chỉ nhận qua PR-review (AGENTS.md).
- **CI có 2 nguồn tín hiệu song song trên mỗi PR**:
  - GitHub Actions (`CI / build`): **luôn FAILURE** vì billing bị chặn, fail ở giây thứ 3 — đèn đỏ giả, vô giá trị, tồn tại trên mọi PR (verify qua `gh pr list --json statusCheckRollup` trên PR #11-#15).
  - Jenkins (`continuous-integration/jenkins/branch`, tại `ci.cmcvn.edu.vn`): **hoạt động thật**, post SUCCESS/ERROR đúng theo build/test thật. (Đính chính: báo cáo scout ban đầu dựa vào decision doc `0019` — đã lỗi thời, code đã tiến thêm qua commit `feat(ci): expose Jenkins at ci.cmcvn.edu.vn`, `fix(ci): make Jenkins pipeline operational`.)
  - Lưu ý thêm từ đọc `Jenkinsfile`: integration test + build/deploy/smoke chỉ chạy `when { branch 'main' }` — PR vào `develop` chỉ được lint+typecheck làm cổng kiểm tra, chưa chạy full integration test ở mức PR.
- Dự án đã có 2 tính năng tương tự Jules trong ClaudeKit (`vibe --ship`, `team`) nhưng đang khoá Tier 3 — không phải vì thiếu CI signal (đã có Jenkins thật) mà vì tín hiệu Actions giả gây nhiễu khi tự động hoá quyết định merge.
- Không có bất kỳ tài liệu/decision nào từng nhắc Jules trước đây — hoàn toàn mới với repo.
- Rủi ro kỹ thuật cụ thể cho Jules: nếu nó coi "tất cả check phải xanh" là điều kiện xong việc, nó sẽ luôn thấy Actions đỏ (không thể sửa bằng code) → có thể lặp vô ích, tốn quota.

## 3 hướng đã đánh giá

| Hướng | Mô tả | Ưu | Nhược |
|---|---|---|---|
| A. Sandbox thuần túy | Chỉ nối vào repo/nhánh test tách biệt hoàn toàn khỏi code thật | An toàn tuyệt đối | Free tier 5 task/tháng quá ít để đánh giá thật; không phản ánh workflow thật (monorepo, Postgres integration test) |
| **B. Nhánh feature thật, có hàng rào (CHỌN)** | Xoá Actions chết trước; Jules nhận việc qua issue label riêng (vd `jules-ok`); PR chỉ đổ vào `develop`, không bao giờ `main`; Jules không có quyền merge, người review tay | Khớp mục tiêu "tự sửa lỗi nhỏ khi vắng mặt"; khớp yêu cầu "chỉ dùng nhánh/repo tách biệt trước" (vì vẫn cách ly khỏi `main`); có đường lên production khi đã tin tưởng; tận dụng Jenkins signal thật đã có sẵn | Tốn công dọn Actions + cấu hình label trước khi bắt đầu; vẫn cấp quyền tài khoản cá nhân vào repo thật |
| C. Trì hoãn | Chờ Google có gói tổ chức | An toàn nhất | Không giải quyết nhu cầu hiện tại; không có timeline rõ ràng từ phía Google |

## Giải pháp đề xuất: Hướng B

### Rationale
- Khớp cả 2 điều kiện user đặt ra: mục tiêu thật (tự sửa lỗi nhỏ khi vắng mặt) + ràng buộc an toàn (không đụng `main`/production trực tiếp).
- Xoá `.github/workflows/ci.yml` là việc nên làm độc lập với Jules — nó không tạo giá trị gì hiện tại (luôn fail ở giây 3), chỉ gây nhiễu tín hiệu cho người và agent.
- Nhánh `develop` + label-gated issue = vùng đệm tự nhiên: Jules không cần quyền cao hơn agent con người đang có, không phá vỡ quy tắc `AGENTS.md`.

### Rủi ro cần lưu ý khi lên plan
1. **Governance tài khoản cá nhân**: Jules gắn OAuth vào 1 tài khoản Google, không có kiểm soát tổ chức, không rõ chính sách giữ dữ liệu private repo. Cần quyết ai đứng tên tài khoản (company hay cá nhân) và ghi vào decision doc.
2. **Coverage CI thật ở mức PR còn mỏng**: `Jenkinsfile` chỉ chạy integration test khi merge vào `main`, PR vào `develop` chỉ có lint+typecheck. Nếu để Jules tự tin cậy "PR xanh = an toàn", nó có thể bỏ sót lỗi integration. Cân nhắc thêm 1 stage integration test chạy trên PR trước khi bật Jules thật.
3. **Actions dọn dẹp**: xoá `.github/workflows/ci.yml` là thay đổi CI/CD pipeline — theo `docs/FEATURE_INTAKE.md` risk checklist đây chạm "Existing behavior" + có thể "External systems" → nên ghi decision doc riêng, không làm âm thầm.
4. **Intake lane**: theo `docs/FEATURE_INTAKE.md`, việc cấp quyền cho 1 dịch vụ cloud bên ngoài đọc/ghi code (External systems) là **hard gate → high-risk lane** bắt buộc khi lên `/ck:plan`, cần `execplan.md`/`design.md`/`validation.md` đầy đủ, không được rút gọn thành tiny/normal.

## Success metrics / validation criteria
- Jules mở được ít nhất 1 PR hợp lệ vào `develop` từ 1 issue có label `jules-ok`, pass lint+typecheck, không đụng `main`.
- Xác nhận Jules **không** loop vô ích vì Actions đỏ giả (theo dõi số task tiêu tốn trên 1 issue đơn giản).
- Free tier (5 task/tháng) đủ để chạy ít nhất 2-3 vòng thử nghiệm có ý nghĩa trước khi cân nhắc nâng Pro.
- Không phát sinh commit/push nào vào `main` từ tài khoản Jules trong suốt giai đoạn thử nghiệm.

## Next steps / dependencies
1. Xoá `.github/workflows/ci.yml` (decision doc riêng, ghi rõ lý do: billing-blocked, vô giá trị, gây nhiễu tín hiệu).
2. (Tuỳ chọn, khuyến nghị) thêm stage integration-test chạy trên PR vào `develop`, không chỉ khi merge `main`.
3. Quyết ai đứng tên tài khoản Google cho Jules + đọc kỹ chính sách dữ liệu hiện hành của Jules trước khi cấp quyền repo thật.
4. Tạo GitHub label `jules-ok` (hoặc tên tương đương) để giới hạn phạm vi issue Jules được nhận.
5. `/ck:plan` ở **high-risk lane** (theo FEATURE_INTAKE hard gate "External systems") để viết execplan/design/validation đầy đủ trước khi bật thật.

## Unresolved questions
- Google chưa công bố enterprise/org controls cho Jules — nếu chính sách đổi, cần review lại quyết định.
- Chưa rõ context window thật (768K là số không chính thức) — cần thử nghiệm với 1 issue thật trong monorepo để đo.
- Chưa quyết ngân sách Pro tier ($19.99/th) có được duyệt lâu dài hay chỉ dùng thử.
