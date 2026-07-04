# Phase 1 — CRM module + Modal-ize "Tạo cơ hội"

**Findings resolved:** #6, #13, #18, #20, #25
**~~#4~~ DROPPED — already fixed on `main` (PR #26, commit `ec6d1c4`, pre-dates this plan's rebase):**
`opportunity-detail.tsx:612-613` already passes `fieldLabels={{ stage: 'Giai đoạn', ownerId: 'Người phụ trách' }}` +
a `formatValue` to `<Chatter>`. Verified live on this branch after fast-forwarding to `main` tip
(84ff0d2) — no raw enum/uuid leak remains. Do not re-touch `crm.ts` log text or `Chatter` formatting
for this finding.
**Effort:** 2.5h (was 3h, #4 removed) · **Lane:** normal

## Context links

- `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` (findings #6, #13, #18, #20, #25 — #4 resolved separately)
- `plans/reports/brainstorm-260703-1341-ui-rebuild-stitch-wireframe-scope-report.md` (approach A — Modal, copy students/courses-panel)
- `docs/design-system.md` — Modal section (radius `xl`, centered, max 640px for forms) + Anti-Patterns
- Reference pattern: `apps/admin/src/courses-panel.tsx` (`useDisclosure` + `useForm`), `apps/admin/src/students-panel.tsx`

## Files to modify

- `apps/admin/src/crm-panel.tsx` (create form → Modal; #25, #13, #18, #20)
- `apps/admin/src/opportunity-detail.tsx` (stage stepper #6)
- `apps/admin/src/contact-directory-panel.tsx` (refresh-after-create #18)
- `apps/admin/src/crm-shared.ts` (stage-label helper reused by #13; read-only reference)

**Do NOT touch** `apps/api/src/routers/crm.ts` or `opportunity-detail.tsx`'s `<Chatter fieldLabels=…>` — #4 is already resolved there.

## Current code shape (verified)

- `crm-panel.tsx:273-334` — the "Tạo cơ hội mới" form is a fixed `<Card withBorder>` rendered **above** the pipeline. Fields are loose `useState`: `fullName, phone, studentName, program, medium, campaign` (lines 134-139); submit = `createLead()` (183-215) which calls `crm.contactCreate` then `crm.opportunityCreate`, then clears fields + `load()`.
- `crm-panel.tsx:281-306` — duplicate-phone `Alert` (depends on `phone` + `opps`) — must move **into** the Modal (it warns while typing the phone).
- `crm-panel.tsx:331` — button label `Tạo cơ hội (O1)` leaks the O1 code (#13).
- `crm-panel.tsx:108, 292` — `PT: {ownerName(...)}` abbreviation (#20).
- `crm-panel.tsx:336` — `<ContactDirectoryPanel facilityId={facilityId} />`: it self-loads on `facilityId` change only, so after `createLead` adds a contact the directory is stale (#18).
- `opportunity-detail.tsx:102-142` `StageBar` — `active = s.value === current`, `done = i < idx`. This is correct *only if* `stageIndex(current)` resolves; verify the "wrong current stage highlight" is a data issue (closed/won opp) vs. logic (#6).
- `crm-shared.ts:7-13` `STAGES` already has `value → label` ("O1 · Lead" …); `STAGE_LABEL` map built in `crm-panel.tsx:41`.
- `crm-panel.tsx:134` `const [phone, setPhone] = useState('')`; `crm-panel.tsx:176` `duplicateOpenOpps = useMemo(() => {...}, [opps, phone])` reads this state var directly — **this dependency must migrate to `form.values.phone` in step A.1, not stay pointed at a removed/parallel `phone` state** (red-team flagged: silently breaking this guard removes the double-lead warning with no test catching it).

## Implementation steps

### A. #25 + #13 + #18 + #20 — Modal-ize CRM create form
1. In `crm-panel.tsx`, add `const [opened, { open, close }] = useDisclosure(false)` and migrate the six loose fields to a single `useForm` (mirror `courses-panel.tsx:40-47`; keep `program` optional, `fullName`/`phone` required via `required(...)` from `@cmc/ui`). **Do not keep a parallel `useState('')` for `phone`** — update `duplicateOpenOpps`'s `useMemo` dependency array from `[opps, phone]` to `[opps, form.values.phone]` and its body to read `form.values.phone` (see "Current code shape" note above; this guard warns reps about double-working a lead and must keep tracking the live typed value).
2. Remove the fixed `<Card>` (273-334). Add a "Tạo cơ hội" primary button in `PageHeader actions` (next to the facility `Select`), `leftSection={<IconPlus/>}`, `onClick={open}`.
3. Move the form + duplicate-phone `Alert` into a `<Modal opened={opened} onClose={close} title="Tạo cơ hội" radius="xl" centered>`. `createLead` becomes the `form.onSubmit` handler; on success call `close(); form.reset();` then refresh (step 5).
4. #13: rename button label `Tạo cơ hội (O1)` → `Tạo cơ hội` (submit button inside modal). Do not surface stage codes in user copy; keep `STAGES` labels ("O1 · Lead") only inside the stage picker where the code is intentional shorthand.
5. #18: give `ContactDirectoryPanel` a `refreshKey: number` prop (or an imperative `onRegisterReload`). Simplest KISS: add `refreshKey` prop, bump a `const [contactsRefresh, setContactsRefresh] = useState(0)` in `crm-panel.tsx` inside the create-success path; in `contact-directory-panel.tsx` add `refreshKey` to the `load` `useEffect` deps (`useEffect(load, [load])` → include `refreshKey`). Keep the panel's own facility-change reload intact.
6. #20: replace `PT:` with `Phụ trách:` at `crm-panel.tsx:108` and `:292`.

### B. #6 — stage stepper highlights wrong current stage
1. Reproduce against a mid-pipeline opp (e.g. O3). Inspect `StageBar` (`opportunity-detail.tsx:112-141`): if `stageIndex(current)` returns -1 for an unexpected stored value, `done` logic misfires. Verify `opp.stage` value matches a `STAGES[].value` exactly.
2. Most likely fix (grounded): the "current" that appears wrong is a **closed/won** opp where `disabled` freezes all buttons and the filled "active" is on O5 while the badge says otherwise — confirm `current={opp.stage}` is the live stage, not a stale prop. Apply minimal correction to the `active`/`done` comparison or the passed `current`. Do **not** change transition behavior.

## Validation / tests

- [ ] Create form only reachable via the "Tạo cơ hội" button; opens a centered `xl` Modal; no fixed Card above the pipeline.
- [ ] Duplicate-phone Alert still fires while typing phone inside the Modal, tracking `form.values.phone` (not a stale/removed `phone` state).
- [ ] After creating a lead: Modal closes, form resets, pipeline **and** contact directory both refresh (#18).
- [ ] Open an O2/O3 opp: stepper highlights the matching stage as current (#6).
- [ ] No "PT:" or "(O1)" string visible in CRM copy (#13, #20).
- [ ] `pnpm -w typecheck` clean; `pnpm --filter @cmc/api test crm` still green (no server-side change this phase, but confirm no accidental breakage).

## Risks & rollback

- **Shared idiom with Phase 6** — use the exact `useDisclosure`+`useForm` shape from `courses-panel.tsx`; do not diverge, or the two phases drift.
- **`duplicateOpenOpps` regression** — the single highest risk in this phase; test explicitly (see checklist) since nothing else guards it.
- **#6 is diagnosis-first** — if it turns out to be a false positive (correct behavior on a closed opp), document and skip rather than altering `StageBar` logic (avoid inverting the forward-only guard).
- Rollback: each finding is an isolated edit; revert per-file. The Modal migration is the only structural change — revert `crm-panel.tsx` to restore the Card form.
