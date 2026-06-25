# Agent Instructions

## Branch workflow (bắt buộc)

- **Không bao giờ code/commit thẳng lên `main`.** `main` chỉ nhận thay đổi qua Pull Request đã review.
- Nhánh làm việc mặc định là **`develop`** (tạo từ `main`). Mọi task chạy trên `develop`, hoặc trên nhánh feature/fix tạo **từ `develop`**.
- Hoàn thành việc → PR vào `main` (hoặc PR feature→`develop` trước nếu cần gộp). Trước khi mở session làm việc, kiểm tra đang đứng đúng nhánh: không phải `main`.
- Nếu phát hiện đang ở `main`, dừng lại và chuyển/`checkout` sang `develop` (hoặc nhánh feature) trước khi thay đổi file.

<!-- HARNESS:BEGIN -->
## Harness

This repo uses Harness. Before work, read:

- `README.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `docs/TOOL_REGISTRY.md`
- `scripts/bin/harness-cli query matrix` on macOS/Linux, or `.\scripts\bin\harness-cli.exe query matrix` on Windows

Use the Rust Harness CLI at `scripts/bin/harness-cli` on macOS/Linux or
`scripts/bin/harness-cli.exe` on Windows as the main operational tool. Before a
step that could use an external tool, run `scripts/bin/harness-cli query tools
--capability <name> --status present` to see what is equipped; an absent
capability is a clean skip.
<!-- HARNESS:END -->

## ClaudeKit usage

Skills and agents in the ClaudeKit suite (`/ck:*`) are this repo's
execution layer. They run **inside** the Harness Task Loop, never around it:

1. Classify the request with `docs/FEATURE_INTAKE.md` and record it
   (`harness-cli intake`).
2. Pick the ck capability for the current phase and lane from the routing table
   in `docs/CK_WORKFLOW.md` (Intake / Planning / Implementation / Validation /
   Trace × tiny / normal / high-risk).
3. The Harness durable layer (`harness-cli`) stays the source of truth — **run
   ck to do the work, record the Harness to prove it.** Never skip
   `harness-cli trace` because a ck skill already wrote a journal.

`ship` / `review-pr` / `vibe --ship` / `team` stay deferred until a green CI
exists (GitHub Actions billing is blocked → runs fail at ~3s; Jenkins not yet
built) — see `docs/CK_WORKFLOW.md` §5. The ELI5 output style
(`.claude/.ck.json` `codingLevel: 0`) is an intentional operator setting; keep it.
