# ERP-LINK-PREVIEW — ERP module-aware internal link previews

## Status

implemented

## Lane

normal

## Product Contract

ERP staff URLs must identify the CMC ERP surface and the current module when shared or opened, so staff can understand a link before clicking it. This is internal link-preview clarity, not public search-engine optimization.

## Relevant Product Docs

- `README.md`
- `docs/FEATURE_INTAKE.md`
- `docs/CONTEXT_RULES.md`

## Acceptance Criteria

- `apps/admin/index.html` includes ERP-specific title, description, favicon, apple icon, Open Graph, and Twitter card metadata.
- Reachable ERP modules such as `/crm`, `/finance`, `/schedule`, `/hr`, and `/kpi` have route-specific title and description in built HTML.
- `/crm/opportunities/:oppId` uses CRM opportunity metadata instead of the root ERP fallback.
- Browser runtime metadata updates when staff navigate between ERP modules.
- LMS is not changed in this story.
- No API, database, authorization, or business workflow contract changes.

## Design Notes

- Commands: none.
- Queries: none.
- API: unchanged.
- Tables: unchanged.
- Domain rules: unchanged.
- UI surfaces: ERP admin shell metadata and static preview HTML only.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | No dedicated unit test for `link-preview-metadata.ts` yet. Admin suite `pnpm --filter @cmc/admin test` is green (8/8, `nav-consistency.test.ts`) — confirms no regression, but does NOT exercise this feature. Coverage gap: `getAdminMetadata` fallback + `renderHtmlForMetadata` regex are untested. |
| Integration | Not required; no API/data behavior changed |
| E2E | Not required; metadata/build-only ERP change |
| Platform | Raw built HTML inspection for module metadata — primary proof for this feature |
| Release | Build output includes module HTML files for `/finance`, `/crm`, `/schedule`, `/crm/opportunities` |

## Harness Delta

No harness rule changes. This story follows the existing normal-lane intake/story/trace flow.

## Evidence

- `pnpm --filter @cmc/admin typecheck` — PASS.
- `pnpm --filter @cmc/admin lint` — PASS.
- `pnpm --filter @cmc/admin build` — PASS with existing Vite chunk-size warning only.
- `pnpm --filter @cmc/admin test` — PASS, 1 file / 8 tests (pre-existing `nav-consistency.test.ts`; regression guard only, no link-preview coverage).
- Built HTML inspection confirmed module-specific title + description for:
  - `apps/admin/dist/finance/index.html`
  - `apps/admin/dist/crm/index.html`
  - `apps/admin/dist/schedule/index.html`
  - `apps/admin/dist/crm/opportunities/index.html`
- `gitnexus_detect_changes({ scope: "all", repo: "CMCnew" })` — medium risk limited to admin `Dashboard` / `handleSectionChange` flows.
- Code review agent: DONE, no Critical/High/Medium issues.
