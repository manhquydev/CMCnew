# Phase 2 — Frontend detail panel implementation report

## Executed Phase
- Phase: phase-02-frontend-detail-panel
- Plan: D:\project\CMCnew\plans\260704-2130-cong-ca-workflow-ux-fixes
- Status: completed

## Files Modified
- `apps/admin/src/shift-reg-detail-panel.tsx` (~40 lines changed/added)

## Tasks Completed
- [x] A3: SINGLE-mode shift cell changed from `<Radio>` to `<Checkbox radius="xl">`, keeps `onChange` only (no `onClick`), `disabled={!isDraft}` preserved. Multi-select `<Checkbox>` untouched. Removed now-unused `Radio` import.
- [x] A2 detail: added `handleUpdateDates(fromDate, toDate)` calling `trpc.shiftRegistration.updateDates.mutate({id, fromDate, toDate})`, on success calls `loadReg()` to refresh reg + entries (backend already deletes out-of-range entries); on error `notifyError` + local state untouched since header no longer holds separate edit state (reads directly from `reg`, so failure naturally reverts UI once `busy` clears without stale local override). Header Card renders two `DateInput` (draft) with `minDate = tomorrow`, replacing the static Text fields; non-draft keeps original read-only Text display.
- [x] A2 NewRegForm: default `fromDate` changed from `today` to `tomorrow` (`dayjs().add(1,'day')`), `toDate` default unchanged (`+1 month`), added `minDate` to both `DateInput`s.

## Tests Status
- Type check: pass (`pnpm --filter admin exec tsc --noEmit -p tsconfig.json`, exit 0)
- Unit tests: not run (no unit tests exist for this component; out of scope per phase file)
- Integration tests: not run (Phase 4 owns test coverage)

## Issues Encountered
None. Backend `updateDates` input schema confirmed via `apps/api/src/routers/shift-registration.ts:334-382` — `{id: uuid, fromDate: YYYY-MM-DD string, toDate: YYYY-MM-DD string}`, returns updated `shiftRegistration` row (no entries), so `loadReg()` reload (not the mutation's return value) is used to refresh both `reg` and `selected` entries map — matches phase note "tái dùng loadReg()".

`busy`/rollback guards on `toggle()` are untouched; `handleUpdateDates` reuses the same `busy` flag to disable date inputs during save, consistent with existing `handleSubmit`/`handleWithdraw` pattern.

## Next Steps
Phase 4 (tests & verification) can now cover: single-mode checkbox deselect, draft date-range edit (success + out-of-range validation + backend rejection paths), NewRegForm minDate enforcement.

Status: DONE
Summary: A3 fixed via Checkbox-as-radio (root cause: Radio never fires onChange when already checked); A2 draft date editing wired to new updateDates mutation with reload-on-success; NewRegForm now defaults/min-dates to tomorrow. Typecheck passes.
Concerns/Blockers: none
