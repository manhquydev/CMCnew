# Stage 00-inspect — Brownfield assessment (existing codebase)

Run this BEFORE planning when the project ALREADY EXISTS. Goal: an honest current-state map so
planning starts from reality, not a blank page. Fill every section from EVIDENCE (read the code),
then check the gate. `/flow assess` seeds the auto-scan and validates this gate.

## Gate — check ALL before planning
- [ ] I detected the stack / build / test / run commands (from real files; listed below)
- [ ] I mapped the main components/modules and entry points
- [ ] I assessed current functionality state (works / partial / broken) with file evidence
- [ ] I assessed UI/UX state vs the product's stated goals (or noted "no UI")
- [ ] I listed the top risks / tech-debt / known issues
- [ ] I noted the test + quality baseline (what is covered vs not)
- [ ] A human reviewed this assessment (brownfield assessment is operator-gated)
- [ ] No FILL placeholders remain in this file

## Detected (auto-scan)
[FILL: replace with the `/flow assess` auto-scan output — stack, CI, context files]

## Ranked surfaces (auto-scan — read these first)
The auto-scan ranks source files by how widely their symbols are referenced (highest-leverage
code first). Start your functionality + risk assessment from the top of that list — the surfaces
most of the codebase depends on are where a hidden cross-cutting risk (e.g. unscoped data access)
is most likely to hide. [FILL: note which ranked surfaces you inspected + what you found.]

## What this product is (from docs/specs/code, not guesses)
[FILL: 2-3 sentences — the real product + who it's for + the core job]

## Current functionality state (evidence)
[FILL: per major feature — works / partial / stub / missing, each with file:line]

## UI / UX state vs product goals
[FILL: screens/flows present + gaps vs the stated goals; or "no UI"]

## Risks / tech-debt / known issues
[FILL: top items, ranked; cite where]

## Test + quality baseline
[FILL: what is tested vs not; how to run the suite; coverage if known]

## Verdict
[FILL: is the codebase healthy enough to build on? what must be fixed first?]

<!-- auto-scan -->
stack:
  - node (package.json)
  - CI: github actions (.github/workflows)
context files present:
  - README.md
  - AGENTS.md
  - CLAUDE.md
  - docs
ranked surfaces (most-referenced first - inspect these before planning):
  1. packages/ui/src/components.tsx  (score 1138; Button, Card)
  2. apps/api/src/routers/payroll.ts  (score 1091; where, block, commission)
  3. packages/ui/src/status-badge.tsx  (score 936; style, StatusBadge, resolvedLabel)
  4. apps/api/src/annotation.ts  (score 770; color, point, annotationDataSchema)
  5. apps/api/src/routers/finance.ts  (score 736; facilities, studentCode, decision)
  6. apps/api/src/index.ts  (score 707; userId, html, fail)
  7. packages/ui/src/pdf-annotator.tsx  (score 630; text, live, empty)
  8. packages/ui/src/client.ts  (score 578; trpc, API_URL, uploadSessionPhoto)
  9. apps/api/src/trpc.ts  (score 461; requirePermission, router, protectedProcedure)
  10. packages/ui/src/notify.ts  (score 454; notifyError, notifySuccess, rawMessage)
