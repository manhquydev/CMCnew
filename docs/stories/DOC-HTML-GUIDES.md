# DOC-HTML-GUIDES Static HTML Staff Guides

## Status

implemented

## Lane

normal

## Product Contract

The existing director and sale/teacher markdown user guides must also be available as static, visual HTML guides with screenshots taken from the local CMCnew staff app where feasible.

## Relevant Product Docs

- `docs/huong-dan-su-dung-giam-doc.md`
- `docs/huong-dan-su-dung-sale-giao-vien.md`
- `docs/auth-sso-otp-redirection.md`

## Acceptance Criteria

- Create direct-open HTML guide files for both source markdown documents.
- Include a guide index page linking to both role guides.
- Include shared CSS and JS for readable navigation, section filtering, and image viewing.
- Include local-app screenshots for login, shell/navigation, and key work panels.
- Keep runtime application behavior unchanged.

## Design Notes

- Commands: none.
- Queries: none.
- API: unchanged.
- Tables: unchanged.
- Domain rules: unchanged.
- UI surfaces: static docs under `docs/user-guides/`.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id DOC-HTML-GUIDES --unit 1 --integration 0 --e2e 1 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | Static artifact/link validation. |
| Integration | Not applicable; no backend change. |
| E2E | Browser smoke for direct-open HTML and screenshot assets. |
| Platform | Not applicable. |
| Release | Not in scope. |

## Harness Delta

No Harness policy changes expected. Record friction if local screenshot capture is blocked by environment.

## Evidence

- `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-user-guides.ps1` -> `user-guides-ok`.
- `scripts/bin/harness-cli.exe story verify DOC-HTML-GUIDES` -> pass.
- Playwright opened `docs/user-guides/index.html`, `huong-dan-su-dung-giam-doc.html`, and `huong-dan-su-dung-sale-giao-vien.html` directly from `file:///`; no broken images; role filter JS works.
- Screenshots captured from local CMCnew staff app at `http://localhost:5173` using seeded super_admin session for visual evidence. Role-specific SSO sessions were not used.
- Follow-up after review: removed screenshots containing CRM/finance/user-table data and all orphan guide screenshots; guide now keeps only referenced screenshots. `scripts/verify-user-guides.ps1` now fails on orphan PNGs, forbidden screenshot names, and oversized screenshots.
- Follow-up content depth: director and sale/teacher guides now include E2E use-case walkthroughs for login, create staff, CRM/admissions, CSKH, KPI approval, class lifecycle, schedule, attendance, grading, assessment, level-up, parent meetings, payroll, and entrance-test grading.
- Follow-up accessibility proof: Playwright direct-open smoke confirmed no broken images; role filter sets `aria-pressed` and hides matching TOC links; image zoom is keyboard-focusable, opens a dialog with focus on close, and closes with Escape.
- Follow-up onboarding depth: guide index and role pages now use a docs-style structure inspired by ClaudeKit docs: role overview, first-login checklist, "what to do first" cards, and day-one/day-workflow E2E guides for Sale, Giáo Viên, GĐ Kinh Doanh, and GĐ Đào Tạo.
- Follow-up visual E2E depth: added safe SVG walkthroughs for CRM admission, finance read-only boundary, director first day, training class lifecycle, staff onboarding, KPI approval, teacher day, and entrance-test grading. Existing local screenshots remain for login/orientation panels; synthetic visuals are used where live screens can expose customer/student/receipt data or role-specific controls.
- Follow-up language pass: visible guide text and SVG labels were rewritten in simpler Vietnamese, replacing technical labels such as "Use case E2E", "pipeline", "SSO", "ERP", "dashboard", and "form" with user-facing wording.
- Vercel deploy: guide bundle is self-contained under `docs/user-guides/` and deployed as separate Vercel project `manhquy/user-guides`, production URL `https://user-guides-inky.vercel.app/`. Production smoke returned 200 for index, both guide pages, one SVG, and one PNG; browser smoke found no broken images.
