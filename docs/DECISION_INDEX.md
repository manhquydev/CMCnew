# Decision Index

<!--
UPDATE RULE: only add or change a row when (a) a new decision doc is created per
docs/FEATURE_INTAKE.md's hard-gate, or (b) the user explicitly confirms a changed
decision mid-work (create a new decision doc that supersedes the old one; update
this row to point at the new doc; do NOT delete the old doc or row history).
Never add a row speculatively without a backing decision doc.
-->

Grep-able pointer table: which code area is governed by which accepted decision.
**Pointer only — do not copy decision content here.** Read the linked doc before
editing a matched file. See `AGENTS.md` / `CLAUDE.md` → "Decision Lookup (Hard Rule)".

`0035` is the founding entry — a fully-verified retrofit of a rule that shipped
in code with no prior written decision, closing that exact gap. See
`plans/reports/brainstorm-260704-2259-decision-defense-layer-and-lost-logic-audit-report.md`.

| Module/File pattern | Rule (1 line) | Decision doc | Status |
|---|---|---|---|
| `apps/api/src/routers/shift-registration.ts` (create/updateDates/submit) | 1 phiếu Nháp/Chờ duyệt tại 1 thời điểm; fromDate phải tương lai (Asia/Saigon) | `docs/decisions/0035-shift-registration-ticket-lock.md` | Accepted |
| `apps/api/src/routers/shift-registration.ts` (approve, manager resolution) | Shift approval owned by employee's direct manager (`EmploymentProfile.managerId`), HR, or super admin; facility WiFi/IP config is super_admin/IT-only | `docs/decisions/0020-work-shift-manager-ownership.md` | Accepted |
| `apps/api/src/routers/shift-registration.ts` (delegated approver, afterSale) | Delegated shift approver + afterSale sale-grant | `docs/decisions/0027-delegated-shift-approver.md` | Accepted |
| `apps/api/src/routers/check-in-out.ts` | Manual attendance outside WiFi: per-day ticket (not per-punch), single reason, single approve/reject | `docs/decisions/0034-manual-attendance-daily-ticket.md` | Accepted |
| `packages/domain-academic/src/code.ts`, `apps/api/src/services/batch-code.ts`, `schema.prisma` (BatchCodeCounter) | Class code = [Facility.code]-[ProgramAbbrev]-[YY]-[seq], counter keyed by (facility, program, year) | `docs/decisions/0036-class-code-facility-program-format.md` | Accepted |
| `apps/api/src/lib/attendance-penalty.ts`, `payroll.ts` | Attendance penalty → payslip post-tax deduction | `docs/decisions/0025-attendance-penalty-payroll-deduction.md` | Accepted |
| `apps/api/src/lib/callio-client.ts`, `EmploymentProfile.callioExt` | Callio (Phonenet) call-metrics feed KPI sale scoring | `docs/decisions/0010-callio-call-metrics-integration.md` | Accepted |
| `apps/api/src/routers/payroll.ts` (KPI section), `apps/api/src/lib/kpi-authz.ts` | KPI auto-score + tree-override + audit | `docs/decisions/0011-auto-kpi-with-tree-override-audit.md` | Accepted |
| `apps/api/src/routers/payroll.ts` (compensation params) | Safe-default for ambiguous salary params; all overridable via UI | `docs/decisions/0012-payroll-ambiguous-params-safe-defaults.md` | Accepted |
| `apps/api/src/routers/payroll.ts` (director scoping) | Payroll director domain scoping | `docs/decisions/0023-payroll-director-domain-scoping.md` | Accepted |
| `EmploymentProfile` (address/nationalId/bankAccount/bankName), `payroll.ts` | HR sensitive fields: mask-only + role-gate + audit (encryption deferred) | `docs/decisions/0026-hr-sensitive-record-mask-only.md` | Accepted |
| `apps/api/src/lib/graph-client.ts`, `apps/api/src/routers/email.ts` | Outbound email via Microsoft 365 Graph API | `docs/decisions/0013-email-microsoft-graph-integration.md` | Accepted |
| `apps/api/src/services/email-outbox.ts`, `apps/api/src/lib/sso.ts` | Split external-recipient email to Brevo, keep Graph for internal staff | `docs/decisions/0030-email-brevo-external-transport-split.md` | Accepted |
| `apps/api/src/routers/auth.ts`, `apps/api/src/rate-limit.ts` | Staff password login runs permanently alongside SSO | `docs/decisions/0031-staff-password-login-parallel-to-sso.md` | Accepted |
| `apps/api/src/routers/lms-auth.ts`, `apps/api/src/trpc.ts` | Student LMS login = parent phone (84xxx) + family profile picker, fixed default password | `docs/decisions/0033-student-login-phone-identity.md` | Accepted |
| `finance-panel.tsx`, `opportunity-detail.tsx` | Commission on sale draft-receipt + auto-O5 on approve | `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` | Accepted |
| `apps/api/src/routers/finance.ts` (receiptCreate), `apps/api/src/routers/crm.ts` (opportunityLookupByPhone), `permissions.ts` (crm.opportunityLookup) | CRM↔finance phone lookup + duplicate-warning; receiptCreate response is a discriminated union | `docs/decisions/0037-crm-finance-receipt-linkage.md` | Accepted |
| `schema.prisma` (RefundLedger) | Refund ledger is append-only money-out; over-refund is a documented DBA/ops SQL path, not a v1 feature | `docs/decisions/0028-refund-ledger.md` | Accepted |
| `schema.prisma` (CurriculumUnit) | Curriculum unit is a global table without RLS | `docs/decisions/0021-curriculum-unit-global-no-rls.md` | Accepted |
| `apps/api/src/routers/exercise.ts`, `schema.prisma` | Exercise/curriculum asset is a global table without RLS | `docs/decisions/0022-exercise-global-curriculum-asset-no-rls.md` | Accepted |
| `apps/api/src/routers/level-progress.ts` | LMS is a homework platform; certificates are manual-only, not auto on level-up | `docs/decisions/0008-lms-homework-platform-certificate-manual-only.md` | Accepted |
| `apps/admin/src/App.tsx`, `main.tsx` | Path-based SPA routing for the admin app | `docs/decisions/0016-path-based-spa-routing.md` | Accepted |
| `record-detail.tsx`, `staff-profile.tsx` | Extend `record-detail.tsx` primitive with `data`/`onStateChange`/`onFieldChange` | `docs/decisions/0032-record-detail-primitive-reactive-extension.md` | Accepted |
| — (harness process/spec lifecycle, no single code file) | Harness-first development | `docs/decisions/0001-harness-first-development.md` | N/A — infra |
| — (harness process) | Generic spec intake harness | `docs/decisions/0003-generic-spec-intake-harness.md` | N/A — infra |
| — (harness durable layer) | SQLite durable layer for harness operational records | `docs/decisions/0004-sqlite-durable-layer.md` | N/A — infra |
| — (harness CLI tooling) | Prebuilt Rust harness CLI (amended twice) | `docs/decisions/0005-prebuilt-rust-harness-cli.md` | N/A — infra |
| — (harness benchmark process) | Phase 4 benchmark triage | `docs/decisions/0006-phase-4-benchmark-triage.md` | N/A — infra |
| — (harness process) | Improvement proposal rules | `docs/decisions/0007-improvement-proposal-rules.md` | N/A — infra |
| — (agent workflow adoption) | ClaudeKit wired into Harness as workflow layer | `docs/decisions/0009-ck-workflow-adoption.md` | N/A — infra |
| — (agent operating playbook) | Daily session loop playbook (brownfield ck × Harness) | `docs/decisions/0017-daily-session-loop-playbook.md` | N/A — infra |
| — (agent capability reference) | ClaudeKit capabilities reference | `docs/decisions/0018-ck-capabilities-reference.md` | N/A — infra |
| — (CI/CD) | CI/CD observability (deploy marker + Jenkins visibility) | `docs/decisions/0019-cicd-observability.md` | N/A — infra |
| — (TLS/edge infra) | Canonical origin TLS: self-signed cert behind Cloudflare Full | `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md` | N/A — infra |
| — (CI/CD environments) | Dev/prod CI/CD environment split with real SSO | `docs/decisions/0032-dev-prod-cicd-environment-split.md` | N/A — infra |
| — (superseded, historical only) | Seed specification product lifecycle (superseded by 0003) | `docs/decisions/0002-post-spec-product-lifecycle.md` | Superseded |
| — (ERP identity provisioning, not yet accepted) | ERP-driven Microsoft Graph identity provisioning | `docs/decisions/0015-erp-microsoft-graph-identity-provisioning.md` | Proposed |

> ⚠️ **Numbering collision**: `0032` is used by two unrelated decisions — `0032-dev-prod-cicd-environment-split.md` and `0032-record-detail-primitive-reactive-extension.md`. Not fixed here (renumbering existing files is a separate, human-approved cleanup — see backlog item below). Both appear in this index under their respective rows.
