---
title: "Brainstorm: hướng xử lý AN TOÀN — hợp nhất feature (UI rebuild + A/B/C/D) vào develop rồi promote prod"
date: 2026-07-04
type: brainstorm
status: converged — approved PA1, next = /ck:plan + red-team + validate
related_audit: plans/reports/deep-audit-260704-1927-develop-missing-feature-merges-and-dev-ui-gap-report.md
decision_by_user:
  - "PA1: integrate develop trước → test dev → promote main"
  - "Quy trình: report + /ck:plan + red-team + validate trước khi động tay"
---

# Hướng xử lý an toàn cho code feature chưa hợp nhất

## 1. Vấn đề (problem statement)

`develop` (và `main`) THIẾU toàn bộ công việc sản phẩm gần đây: ERP UI rebuild P1–P7 + Plan A/B/C/D.
Công việc nằm trong **5 PR đang OPEN** (#27 phase-d→main; #28–31 A/B/C/D→phase-d), chưa merge cái nào.
Dev env build từ `develop` → hiển thị **UI cũ**. Yêu cầu: hợp nhất về nhánh chính **không mất/không
hỏng code, không lãng phí công sức**, test được trước khi đụng prod.

**Không mất mát:** mọi code còn nguyên trong branch + PR (immutable tới khi xoá). Rủi ro thật nằm ở
(a) merge sai làm hỏng/mất công khi giải conflict, (b) promote lên prod (`erp`/`hoc` live) gây sự cố.

## 2. Nghiên cứu đã làm (bằng chứng, không suy đoán)

- `git merge-tree` (non-destructive): develop×phase-d = **0 conflict**; mọi cặp sibling A×B/A×C/A×D/
  B×D/C×D = **0 conflict**.
- **Trial-integration cộng dồn** trong worktree throwaway (đã xoá, không push): merge lần lượt
  phase-d→A→B→C→D lên develop → **CHỈ 1 conflict DUY NHẤT**, ở file docs
  `plans/260703-0052-.../plan.md` (do plan-d và CI/CD cùng sửa). **Zero conflict code.** Cây cuối
  1307 file, đủ nav rail + 14 file datetime picker + CI/CD.
- Bản chất "chồng lấn 150–184 file/nhánh" = **phần base phase-d giống hệt nhau**, KHÔNG phải xung đột.
  Công việc A/B/C/D **trực giao**, ghép sạch.

→ Kết luận: integrate rủi ro THẤP về mặt merge. Rủi ro tập trung ở bước promote prod cuối cùng.

## 3. Các phương án đã cân nhắc

| PA | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **PA1 (CHỌN)** | Integrate lên develop → CI deploy dev → test → PR develop→main | Có tầng test dev trước prod; đúng vai trò develop (đã có CI/CD); 1 lần hợp nhất sạch | Nhiều bước hơn |
| PA2 | Luồng PR gốc A/B/C/D→phase-d→main | Đúng base PR ban đầu | Bỏ qua test dev; develop vẫn lệch (thiếu feature/thừa CI/CD), phải reconcile sau |
| PA3 | Rà soát sâu từng nhánh trước rồi mới quyết | Thận trọng tối đa | Thừa — nghiên cứu đã chứng minh integrate sạch |

## 4. Giải pháp chốt (PA1) — với lưới an toàn

Nguyên tắc: **backup bất biến trước + test dev trước prod + mọi bước qua PR + giữ nhánh/PR tới khi verify.**

1. **Backup net:** `git tag backup/<name>` cho develop, main, phase-d, plan-a/b/c/d (immutable; revert 1 lệnh).
2. **Integration branch** từ develop → merge phase-d→A→B→C→D; giải 1 conflict docs (union) → **PR vào develop**.
3. **Merge develop → CI tự deploy dev** → verify `deverp`/`devlms` hiện UI mới; chạy test happy→edge +
   test suite/E2E; **đồng thời live-test webhook** bằng chính push thật này.
4. **PR `develop → main`** để promote prod — **BƯỚC RỦI RO CAO** (deploy UI rebuild lên prod live):
   backup DB/nginx trước, deploy qua CI/runbook, verify health + smoke, rollback nếu fail. Chờ user duyệt.
5. **Sau khi verify trên main:** đóng PR #27–31 (đã thay thế) kèm note, xoá nhánh đã merge, giữ backup tag.

## 5. Rủi ro & giảm thiểu

- **Promote prod = release LỚN** (toàn bộ UI rebuild + A/B/C/D lên prod đang chạy): tách riêng, có
  red-team + validate, backup + rollback, verify từng bước. Đây là lý do chọn quy trình đầy đủ.
- **1 conflict docs:** giải bằng union (giữ cả nội dung dev-prod-cicd plan + red-team session 2).
- **Migration/DB:** cần kiểm tra các nhánh feature có migration mới không (Plan C student phone login
  nhiều khả năng có schema change) → plan phải có bước migrate + verify trên dev trước prod.
- **Regression:** chạy test suite + E2E trên dev sau integrate; code-review blast-radius.
- **Webhook:** test gộp vào push integrate đầu tiên (khỏi push rác).

## 6. Tiêu chí thành công

- develop chứa đủ CI/CD + phase-d + A/B/C/D; dev env (`deverp`/`devlms`) hiện UI mới đúng bản gần đây.
- Test happy→edge + suite/E2E xanh trên dev; 0 code bị mất (đối chiếu file/feature signature).
- Prod promote xong: `erp`/`hoc` chạy bản mới, health/smoke xanh, rollback sẵn sàng.
- 5 PR cũ đóng gọn, backup tag còn.

## 7. Bước tiếp theo & phụ thuộc

- → `/ck:plan` (default, KHÔNG --tdd: code đã viết+test trong nhánh; đây là merge+deploy, cần verify
  gate chứ không phải tests-first-driven) tạo plan theo phase: Backup → Integrate→develop → Dev verify
  → (gate) Prod promote → Cleanup. Sau đó red-team + validate, đặc biệt siết phase promote prod.
- Phụ thuộc: ops runbook `docs/dev-prod-cicd-runbook.md` + `docs/prod-deploy-security-runbook.md`;
  ops-hardening backup drill (đang pending operator) là điều kiện nên có trước promote prod.

## Câu hỏi chưa giải quyết (đưa vào plan/validate)

- Các nhánh feature có DB migration mới nào cần chú ý thứ tự apply không? (cần quét trong plan)
- Prod promote: chọn cửa sổ giờ thấp tải hay làm ngay? (quyết ở validate)
- Có cần smoke E2E persona trên dev trước promote không (test-matrix)?
