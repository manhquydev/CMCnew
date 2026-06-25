# 0009 Vận dụng ClaudeKit qua workflow cắm vào Harness

Date: 2026-06-25

## Status

Accepted

## Context

ClaudeKit (ck) cung cấp ~50 skill/command + nhiều dev-agent (plan, cook, fix,
debug, code-review, research, scenario, security, docs, ship, team, vibe, flow…).
Dự án đã có **Harness** riêng (intake → risk lane → Task Loop → durable layer
`harness-cli`) quyết định *khi nào / cần chứng minh gì / governance*. Cần một cách
để agent, khi nhận yêu cầu, **tự biết dùng ck nào, ở phase nào, lane nào** mà không
phá governance đã có. Nghiên cứu nội bộ ck (skill thật, không phải bản tóm tắt) đã
hoàn tất; kết quả ghi ở `docs/CK_WORKFLOW.md`.

## Decision

1. **ck là tầng execution; Harness là tầng governance.** ck chạy *bên trong* Task
   Loop của Harness, không thay thế. Nguyên tắc: "chạy ck để *làm*, ghi Harness để
   *chứng minh*"; không bao giờ bỏ `harness-cli trace` vì ck đã viết journal.
2. **Routing theo phase × lane** dùng bảng ở `docs/CK_WORKFLOW.md` §3. plan-mode ck
   map theo lane: tiny=`--fast`/none · normal=default/`--hard` · high-risk=`--deep`/
   `--two`; thêm `--tdd` khi cần giữ hành vi cũ.
3. **Wiring:** thêm mục "ClaudeKit usage" vào `AGENTS.md` (ngoài block
   `HARNESS:BEGIN/END`) trỏ tới `docs/CK_WORKFLOW.md`.
4. **Adoption depth:** Tier 1 dùng ngay (scout/ask/brainstorm/research/plan/scenario/
   cook/fix/debug/test/code-review/security/docs/journal/watzup/git/worktree/
   project-management). Tier 3 (`ship`/`review-pr --fix`/`vibe --ship`/`team`)
   **hoãn** đến khi có CI xanh: GitHub Actions đang bị chặn billing (run fail ~3s),
   Jenkins chưa dựng — không có CI xanh để gate auto-merge.
5. **Ranh giới git giữ nguyên** theo `AGENTS.md`: không để ck build-skill auto-commit
   lên `main`; commit chỉ trên `develop`/feature; PR→`main` người duyệt.
6. **Routing là advisory theo thiết kế.** Không có hook nào ép agent chọn đúng lệnh
   ck; governance thật nằm ở durable layer (`harness-cli` intake/story/trace/decision).
   Cố ý KHÔNG thêm hook enforcement (rủi ro xung đột hook + tăng token mỗi prompt,
   giá trị thấp). AGENTS.md (always-loaded) + bảng routing là "biển chỉ đường" agent
   được tin tuân theo; harness-cli là rào chắn ghi nhận.

## Alternatives Considered

1. **Đăng ký ck vào inbound tool registry** (`harness-cli tool register`). Loại:
   registry đó dành cho tool *được probe presence* (linter, deploy-check, gitnexus);
   ck là execution layer của agent, không phải tool inbound — sai abstraction, lại
   fail probe `cli`.
2. **Viết hook `UserPromptSubmit` tự inject bảng routing.** Hoãn: dễ xung đột với
   hook ck hiện có; là quyết định riêng về sau.
3. **Adopt full ck ngay (gồm ship/team/vibe).** Loại lúc này: GitHub Actions bị chặn
   billing nên CI không xanh; Jenkins chưa dựng → các lệnh này không đạt "done" sạch.
   (PR #1/#2 đã merged; pause merge trước đó đã được gỡ.)

## Consequences

Positive:

- Agent có một bảng tra duy nhất để vận dụng ck đúng lane, không phá Harness.
- Governance/proof vẫn nằm ở durable layer; ck chỉ tăng chất lượng execution.
- Bổ sung additive, đảo ngược dễ (gỡ 1 mục AGENTS + 1 decision).

Tradeoffs:

- `AGENTS.md` (always-loaded) dài thêm một mục; chấp nhận vì là entrypoint đúng chỗ.
- Một số sức mạnh ck (ship/team/vibe auto-merge) tạm chưa khai thác cho tới khi có CI.

## Follow-Up

- Khi có CI xanh (gỡ billing GH Actions hoặc dựng Jenkins): xét nâng Tier 3
  (`/ck:vibe` làm runner issue→PR mặc định) — cập nhật `docs/CK_WORKFLOW.md` §5 và
  mở decision mới nếu cần.
- Hook auto-surface/enforce bảng routing: cố ý hoãn (xem Decision điểm 6) — chỉ làm
  nếu xuất hiện bằng chứng agent đi lệch routing nhiều lần.
