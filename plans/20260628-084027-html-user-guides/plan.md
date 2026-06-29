# HTML User Guides Plan

## Status

completed

## Scope

Convert the existing Vietnamese staff guide markdown documents into static HTML guide artifacts with local-app screenshots.

## Expected Output

- `docs/user-guides/huong-dan-su-dung-giam-doc.html`
- `docs/user-guides/huong-dan-su-dung-sale-giao-vien.html`
- `docs/user-guides/index.html`
- `docs/user-guides/assets/guide.css`
- `docs/user-guides/assets/guide.js`
- `docs/user-guides/assets/user-guides/*.{png,svg}`

## Acceptance Criteria

- HTML files open directly in a browser without a dev server.
- Each guide keeps the source markdown's role guidance and key warnings.
- Each guide has navigation, role cards, step callouts, and screenshot figures.
- Screenshot figures come from the local CMCnew app where feasible.
- No runtime app/API behavior changes.

## Scope Boundary

- Do not change app permissions, auth, seeded accounts, API routes, or UI runtime code.
- Do not add generated screenshots of sensitive/private data.
- Do not modify existing unrelated worktree changes.

## Constraints

- Work from `develop`, not `main`.
- Follow Harness intake/story/trace workflow.
- Keep artifacts static and self-contained under `docs/`.
- Use existing markdown docs as source of truth.

## Phases

1. Create story packet and confirm screenshot target list.
2. Capture local app screenshots from seeded/dev environment.
3. Build static HTML/CSS/JS guide files.
4. Validate direct-open HTML, links, assets, and screenshot references.
5. Review with subagents and record Harness trace.

## Validation

- `Test-Path` for every HTML/CSS/JS/screenshot artifact.
- Parse HTML asset references and verify files exist.
- Browser-open static HTML with Playwright when available.
- Optional app screenshot capture from local dev server.

## Evidence

- `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-user-guides.ps1` -> `user-guides-ok`.
- `scripts/bin/harness-cli.exe story verify DOC-HTML-GUIDES` -> pass.
- Playwright direct-open smoke for all 3 HTML files -> titles/H1 present, no broken images, filter JS hides role sections.
- GitNexus `detect_changes(scope=all)` -> no changed symbols/processes, risk `none` because artifacts are static docs.
- Follow-up after parallel review: removed CRM/finance/org-user screenshots, deleted orphan screenshots, added E2E use-case walkthroughs, added keyboard/dialog accessibility for image zoom, and expanded verifier to reject orphan/forbidden/oversized screenshots.
- Follow-up verification: `scripts/bin/harness-cli.exe story verify DOC-HTML-GUIDES` -> pass; Playwright direct-open/accessibility smoke -> no broken images, role filter ARIA state works, keyboard opens/closes lightbox.
- Follow-up onboarding pass: static guides now use docs-style role pages with first-login checklists, "what to do first" cards, and practical day-one/day-workflow E2E instructions for Sale, Giáo Viên, GĐ Kinh Doanh, and GĐ Đào Tạo.
- Follow-up visual E2E pass: added eight safe SVG walkthrough assets under `docs/user-guides/assets/user-guides/` and embedded them under each use case, while reusing local screenshots only for non-sensitive panel orientation. Verifier now checks both PNG and SVG references/orphans.
- Deployment pass: `vercel deploy --prod --yes` was run from `docs/user-guides/`, creating separate Vercel project `manhquy/user-guides`; production URL `https://user-guides-inky.vercel.app/`. Remote smoke verified index, both guide pages, SVG, PNG, role filter, and image lightbox.
