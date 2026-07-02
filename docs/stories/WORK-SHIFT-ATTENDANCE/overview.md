# Work Shift Attendance

## Current Behavior

Work shift registration and punch attendance are implemented and hardened after audit. Latest validation added browser smoke for Admin UI surfaces, including the company WiFi/IP configuration panel. Full manager approval click-through is still proven at API integration level, not as a browser journey.

## Target Behavior

- Kinh doanh selects one 8h shift per day.
- Giao vien can select multiple 4h shifts per day.
- Work and leave entries share the registration flow.
- Employee submits a registration, direct manager approves or rejects.
- Newly approved overlapping registrations supersede older approved registrations.
- Staff punch CHECK-IN/CHECK-OUT; earliest punch is IN and latest punch is OUT.
- Valid facility WiFi/IP produces automatic punch.
- Outside facility IP creates a manual punch approval item for the direct manager.
- Late and early penalties use configured rates in attendance summary logic.
- Facility WiFi/IP ranges are configurable through Admin UI/API, not code edits.

## Affected Users

- Sale staff.
- Teachers.
- Center managers.
- HR and super admin.

## Affected Product Docs

- `docs/ARCHITECTURE.md`
- `docs/codebase-summary.md`
- `docs/roadmap.md`

## Non-Goals

- Payroll payout automation.
- Full browser E2E for the manager approval/rejection journey in this pass.
