---
title: "Rà soát sâu: develop THIẾU toàn bộ code UI/feature gần đây — dev env chạy bản cũ"
date: 2026-07-04
type: deep-audit
severity: HIGH — ảnh hưởng nhận thức trạng thái release
status: REPORT-ONLY — CHƯA thực hiện bất kỳ hành động nào (merge/push/fix)
branch_reviewed: develop @ 0bd45de
---

# Rà soát: vì sao dev env hiển thị giao diện cũ + develop thiếu code

## 0. Kết luận (trả lời 3 câu hỏi của bạn)

1. **"develop đã merge code từ các nhánh khác về chưa?"** → **CHƯA.** develop = `main` +
   14 commit, và **cả 14 đều là devops CI/CD split + docs của tôi** — KHÔNG có code sản phẩm nào.
2. **"dev env giao diện khác/cũ hơn bản gần đây?"** → **ĐÚNG.** dev build từ `develop`, mà develop
   thiếu TOÀN BỘ đợt UI rebuild gần đây (P1–P7) + Plan A/B/C/D. Nên dev hiển thị UI cũ.
3. **"code thiếu plan?"** → **ĐÚNG.** 13 thư mục `plans/2607*` (P1–P7, nav-subtab, sales-flow,
   core-3 reskin...) có trên nhánh feature nhưng KHÔNG có trên develop.

**Không có mất mát dữ liệu** — code vẫn còn nguyên trên các nhánh feature (5 PR đang OPEN). Vấn đề
là **chưa integrate/merge**, không phải mất code.

## 1. Bằng chứng branch/PR

| | Trạng thái | Base | Nội dung |
|---|---|---|---|
| PR #27 | **OPEN** | `main` | `phase-d-facility-picker` — ERP UI rebuild Zero-Elevation + record-detail/calendar (P1–P7), +31 commit |
| PR #28 | **OPEN** | phase-d | Plan A — UX quick-fixes, +36 vs develop |
| PR #29 | **OPEN** | phase-d | Plan B — datetime picker rollout (Mantine), +39 |
| PR #30 | **OPEN** | phase-d | Plan C — student LMS login = phone + family picker, +38 |
| PR #31 | **OPEN** | phase-d | Plan D — admin nav module rail + sub-tab bar, +41 |

- 5 PR đều `MERGEABLE` nhưng `UNSTABLE` (chỉ do check GH Actions luôn đỏ vì billing — KHÔNG phải conflict thật).
- **Cấu trúc STACKED:** A/B/C/D nhắm base = nhánh `phase-d`, còn `phase-d` nhắm `main`. Ý đồ ban đầu:
  gom A/B/C/D lên phase-d rồi phase-d → main. Nhưng **chưa merge cái nào**.
- **A/B/C/D là SIBLING song song, KHÔNG cộng dồn:** plan-D thiếu 5 commit của A, 8 của B, 7 của C.
  Không nhánh nào là superset → phải integrate tuần tự + xử lý conflict giữa các sibling.

## 2. Bằng chứng "develop thiếu gì" (cụ thể)

- **Plan dirs develop thiếu (13):** `260703-1543-erp-ui-rebuild-phase-ab-token-primitives`,
  `260703-1549-p1..p7-*` (7 cái), `260703-2351-erp-admin-reskin-core3`,
  `260704-1034-nav-module-subtab-ia`, `260703-2230-sales-flow-*`, v.v.
- **UI code develop thiếu:** nav module-rail/sub-tab = **0 file trên develop / 2 trên plan-d**;
  datetime picker = **3 trên develop / 13 trên plan-b**.
- **develop hiện chạy gì:** chỉ 8 commit trên cùng là devops/docs (CI-CD split), 0 product commit gần đây.

## 3. Phân kỳ 2 hướng (điểm mấu chốt)

Từ `main@84ff0d22`, code rẽ 2 hướng ĐỘC LẬP, chưa gặp nhau:
- **develop** = main + hạ tầng CI/CD (Jenkinsfile branch-split, dev compose, nginx dev vhost). KHÔNG có feature.
- **các nhánh feature** = main + UI rebuild + A/B/C/D. KHÔNG có CI/CD.

→ Khi integrate, phải gộp CẢ HAI: đưa feature vào develop (để deploy dev test) mà không đánh mất CI/CD;
đồng thời các sibling A/B/C/D chồng lấn UI nên có conflict cần giải quyết.

## 4. Rủi ro / độ phức tạp

- Integrate 5 PR stacked + 4 sibling chồng lấn (mỗi nhánh 150–184 file) = việc LỚN, có conflict thật,
  cần thứ tự merge + test hồi quy. Đây đúng là loại việc cần plan cẩn thận, KHÔNG merge bừa.
- Prod (`main`/`erp`/`hoc`) hiện chạy `84ff0d22` — integrate sai có thể kéo theo prod khi promote lên main.
- CI/CD dev deploy vừa dựng: sau khi feature vào develop, dev sẽ rebuild → cần verify UI mới + hồi quy.

## 5. Phương án integrate (ĐỀ XUẤT — chờ bạn quyết, CHƯA làm)

- **PA1 (khuyến nghị): integrate lên `develop` trước, test trên dev, rồi promote `develop`→`main`.**
  Thứ tự: merge phase-d(#27) vào develop → merge lần lượt A→B→C→D vào develop (giải conflict từng bước)
  → dev tự deploy qua CI → test UI+hồi quy trên deverp/devlms → khi xanh mới PR develop→main.
  Ưu: đúng vai trò develop (integration + dev deploy sẵn có); test thật trước khi đụng prod.
- **PA2: giữ luồng gốc** — gom A/B/C/D vào phase-d, phase-d→main (bỏ qua develop). Nhược: mất tầng
  test dev; và develop vẫn lệch (thiếu feature / thừa CI-CD) → vẫn phải reconcile sau.
- **PA3: rà soát sâu hơn từng nhánh trước khi integrate** — spawn review song song đọc nội dung thực
  A/B/C/D (không chỉ git-level) để lượng hóa conflict + thứ tự an toàn, rồi mới lập plan integrate.

Nếu chọn integrate, đây là việc đủ lớn để chạy **brainstorm → plan → red-team → validate** cho
riêng "chiến dịch integrate" trước khi động tay (đúng như bạn từng nói).

## 6. Về webhook (chưa test — đang giữ theo yêu cầu "không tự ý hành động")

Test webhook cần 1 push `develop` thật → sẽ kích hoạt CI rebuild dev. Vì develop đang trong diện
rà soát, tôi KHÔNG push. Đề xuất: test webhook GỘP vào bước integrate đầu tiên (khi có commit thật
đưa feature vào develop) — vừa test webhook vừa deploy code thật, khỏi push rác.

## 7. Đã làm gì trong phiên này

- CHỈ đọc (git/gh/grep). **KHÔNG** merge, **KHÔNG** push, **KHÔNG** sửa code, **KHÔNG** test webhook.

## Câu hỏi cần bạn quyết

1. Chọn phương án integrate (PA1 khuyến nghị / PA2 / PA3 rà soát sâu trước)?
2. Có muốn tôi chạy brainstorm→plan→red-team→validate cho chiến dịch integrate trước khi động tay không?
3. Webhook: test gộp vào bước integrate đầu, hay bạn muốn 1 push no-op riêng để xác nhận ngay?
4. Xác nhận: đích cuối là đưa feature vào `develop` trước (test dev) rồi mới `main`, đúng không?
