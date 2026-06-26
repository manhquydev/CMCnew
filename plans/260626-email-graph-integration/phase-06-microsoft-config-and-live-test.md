# Phase 06 — Microsoft 365 config + DNS + live-test runbook

**Goal:** The "plug-in" step. After Phases 01–05 ship as no-op-capable code, an admin performs these
Microsoft-side actions, fills env vars, and runs the smoke test. **No application code here** — this
is the operator runbook (also added to `docs/` on finalize).

**Risk:** Ops / external provider. **Compliance note:** research §A flags that A1 *Education*
licensing is for genuine education orgs only; confirm CMC qualifies before production use, else move
to M365 Business/Enterprise. Record this acknowledgement in a `docs/decisions/` entry.

## Step-by-step (maps to research §G checklist)

| # | Action | Where | Output to capture |
|---|--------|-------|-------------------|
| 1 | Create 3 Shared Mailboxes (no license): `erp-notify`, `payroll`, `hr-onboarding` | M365 Admin Center | the 3 addresses → `GRAPH_SENDER_*` |
| 2 | Register single-tenant App Registration | Entra ID | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` |
| 3 | Generate RSA-4096 cert on the API host; upload `.crt` to the app (no client secret) | host + Entra ID | cert path → `GRAPH_CERT_PATH` |
| 4 | Grant **Application** permission `Mail.Send` (admin consent) | Entra ID | — |
| 5 | `Connect-ExchangeOnline`; `New-ServicePrincipal -AppId <clientId> -ObjectId <entAppObjId>` | EXO PowerShell | — |
| 6 | `New-ManagementScope "ERP_Scope"` restricting to the 3 mailboxes | EXO PowerShell | — |
| 7 | `New-ManagementRoleAssignment -Role "Application Mail.Send" -App <sp> -CustomResourceScope "ERP_Scope"` | EXO PowerShell | RBAC limits app to the 3 mailboxes only |
| 8 | DNS: SPF `v=spf1 include:spf.protection.outlook.com -all`; DKIM CNAMEs; DMARC `p=none` (→ tighten to `quarantine`/`reject` after 30–90d) | DNS provider + Defender | deliverability |
| 9 | `Test-ServicePrincipalAuthorization -Identity <sp> -Resource erp-notify@…` | EXO PowerShell | confirms scope |
| 10 | Fill `GRAPH_*` env on the API host; restart API | host | email goes live |

## Live smoke test (after env is set)

1. `GET /health` → `{ ok: true }` (API up).
2. Trigger one real flow per phase, e.g. create a parent with a real test inbox → expect a
   `parent_welcome` email; click the activation link → set password → log in.
3. Inspect `email_outbox`: row transitions `queued → sending → sent`, `sentAt` set, `lastError` null.
4. Confirm DKIM pass in the received mail's headers (Authentication-Results).
5. Negative: stop the app's cert access → next tick leaves rows `queued` (no data loss), logs disabled.

## Operational guardrails (research §H)

- Worker rate cap 20/min < Exchange 30/min; 429 → exponential backoff (built in Phase 01).
- `saveToSentItems:false` keeps shared mailboxes small; set a 90-day EXO retention policy on them.
- Watch for restricted-entity (error 5.1.8) if outbound spam triggers; remediate in Defender portal.
- Rotate the certificate before expiry; document the renewal in the ops doc.

## Done = "ready for real test"
When this runbook is filled in and the smoke test passes, the system is live. Until then the code is
merged and inert (queued, never sent) — safe in production.
