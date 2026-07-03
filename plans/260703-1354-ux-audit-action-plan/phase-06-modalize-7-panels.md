# Phase 6 — Modal-ize remaining 7 create-forms

**Findings resolved:** #25 (extended from CRM to 7 more panels by the scope brainstorm)
**Effort:** 4h · **Lane:** normal
**Depends on:** Phase 1 (defines the shared Modal idiom). Disjoint files from Phase 1 → may run in parallel once Phase 1's pattern is settled.

## Context links

- `plans/reports/brainstorm-260703-1341-ui-rebuild-stitch-wireframe-scope-report.md` (the 8-panel table; approach A = Modal, copy students/courses-panel; **not** a redesign)
- `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` (#25 root finding)
- `docs/design-system.md` — Modal (radius `xl`, centered, form max 640px) + Anti-Patterns ("Placeholder-only labels", form placement)
- **Reference implementation:** `apps/admin/src/courses-panel.tsx` (canonical `useDisclosure` + `useForm` + `open` button + Modal). Same idiom Phase 1 applies to CRM.

## The one shared idiom (copy, do not vary)

```tsx
const [opened, { open, close }] = useDisclosure(false);
const form = useForm({ initialValues: {…}, validate: {…} });   // or keep existing loose useState if trivial
async function create(v) { setBusy(true); try { await api.create.mutate(v); notifySuccess('…'); close(); form.reset(); load(); } catch (e) { notifyError(e, '…'); } finally { setBusy(false); } }
// header row: <Button variant="filled" radius={9999} leftSection={<IconPlus size={16}/>} onClick={open}>Tạo …</Button>
// <Modal opened={opened} onClose={close} title="…" radius="xl" centered><form onSubmit={form.onSubmit(create)}><Stack>…<Group justify="flex-end"><Button variant="subtle" onClick={close}>Hủy</Button><Button type="submit" loading={busy}>Tạo</Button></Group></Stack></form></Modal>
```

## Panels & current form locations (verified — form is a fixed `<Card>` above the list)

| Panel file | Create form (heading) | Anchor lines | Mutation |
|------------|-----------------------|--------------|----------|
| `certificate-panel.tsx` | "Cấp chứng chỉ" (3 field) | Card `:90`, Title `:91`; submit `certificate.issue.mutate` `:63` | `trpc.certificate.issue` |
| `compensation-panel.tsx` | "Tạo phiên bản chính sách lương" (3 field) | Card `:90`, button `createVersion` `:109`; `compensationApi.create.mutate` `:61` | `compensationApi.create` |
| `email-outbox-panel.tsx` | "Gửi phiếu thu qua email" (2 field) | Card `:64`, Title `:65`; `finance.sendReceiptEmail.mutate` `:49` | `trpc.finance.sendReceiptEmail` |
| `facility-network-panel.tsx` | "Thêm IP WiFi công ty" (2 field) | Card `:80`; `facilityNetwork.create.mutate` `:46` | `trpc.facilityNetwork.create` |
| `kpi-evaluation-panel.tsx` | "Tạo phiếu KPI kỳ này" (2 field) | Card `:416`; `payrollApi.kpiEvalStart.mutate` `:393` | `payrollApi.kpiEvalStart` |
| `session-evidence-panel.tsx` | "Nhập tóm tắt/ghi chú buổi học" (2+ field) | Card `:202`; `sessionEvidence.upsertDraft.mutate` `:151` | `trpc.sessionEvidence.upsertDraft` |
| `shift-config-panel.tsx` | "Tạo nhóm ca" + "Tạo mẫu ca" (2 forms) | Cards `:95`, `:105`; `shiftConfig.create` `:57`, `createTemplate` `:68` | `trpc.shiftConfig.create` / `.createTemplate` |

## Implementation steps

For each panel:
1. Add `useDisclosure` state + a "Tạo …" button in the panel header (near the page title / above the list where the Card used to sit).
2. Move the existing form fields (unchanged) from the fixed `<Card>` into a `<Modal … radius="xl" centered>`. Keep the current submit handler; on success add `close()` + reset before the existing `load()`/reload call.
3. Delete the now-empty form Card wrapper; the list/table becomes the panel's primary content.
4. Keep validation as-is (most already `notifyError` on bad input); optionally lift trivial required-checks into `useForm.validate` to match `courses-panel.tsx`, but do not expand scope.

### Per-panel notes
- **`shift-config-panel.tsx`** has **two** forms (group + template) → **two** buttons + two Modals (or one Modal with a segmented control — prefer two buttons, KISS). `loadGroups(fid)` is the reload; preserve it.
- **`kpi-evaluation-panel.tsx`** is large (kanban + row actions). Only the "Tạo phiếu KPI kỳ này" starter Card (`:416`, `kpiEvalStart`) moves to a Modal. Do **not** touch the row-action mutations (`:141-204`).
- **`session-evidence-panel.tsx`** is **contextual** (an inline draft editor tied to one session, `upsertDraft` + `publish`), not a "create new record over a list". Modal may not fit its UX. **Judgment call:** if it is genuinely an inline per-session editor rather than a list+create form, it may not belong in this sweep — confirm against the live screen; if Modal-izing hurts the flow, document why and leave it (the brainstorm listed it, but the anti-pattern is "form above a *list*", which this may not be).
- **`compensation-panel.tsx` / `kpi-evaluation-panel.tsx`** have an info `Card` (`--cmc-info-bg`) at the top — that is a helper banner, not the form; leave it, only move the form Card.

## Validation / tests

- [ ] Each panel: no fixed create-form Card above the list; a "Tạo …" button opens a centered `xl` Modal.
- [ ] Submit success closes the Modal, resets fields, and reloads the list; error keeps the Modal open with the notify toast.
- [ ] `shift-config-panel.tsx`: both group and template creation work via their Modals.
- [ ] `session-evidence-panel.tsx`: either Modal-ized cleanly or explicitly documented as left-inline with reason.
- [ ] Modal idiom matches Phase 1 / `courses-panel.tsx` exactly (grep confirms `useDisclosure` + `radius="xl"` centered across all).
- [ ] `pnpm -w typecheck` + `pnpm -w lint` clean; smoke-test each panel in the running admin app.

## Risks & rollback

- **Divergence from Phase 1** is the main risk — enforce the single idiom; review all 7 in one pass for consistency.
- **`session-evidence-panel.tsx`** genuine-fit risk (see note) — don't force a Modal that degrades the inline editing flow.
- Each panel is an independent edit; rollback per file restores the Card form. No API/schema/authz changes (mutations reused verbatim).
