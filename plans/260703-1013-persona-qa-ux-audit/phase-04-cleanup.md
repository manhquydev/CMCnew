---
phase: 4
title: "Cleanup"
status: pending
effort: ""
---

# Phase 4: Cleanup

## Overview

Revert the temporary security posture change and remove test data — mandatory, not optional,
regardless of how Phase 2/3 go. `STAFF_PASSWORD_LOGIN=true` left enabled on prod is a real
security regression (defeats the SSO-only fail-closed design) if forgotten.

## Implementation Steps

1. Set `STAFF_PASSWORD_LOGIN` back to unset (or `false`) in `/root/cmcnew/.env.production`,
   restart the `api` container, verify a QA-TEST staff account can no longer password-login
   (expect the fail-closed error).
2. Delete/archive all `[QA-TEST]`-tagged data created in Phase 1/2 (accounts, leads, opportunities,
   any other records) — soft-archive per the repo's existing rollback convention, not a hard DB
   delete, unless the created rows are trivial (e.g. a throwaway CRM lead) and archiving isn't the
   existing pattern for that entity.
3. Confirm no `[QA-TEST]` data remains visible in normal admin/LMS list views afterward.

## Success Criteria

- [ ] `STAFF_PASSWORD_LOGIN` reverted, verified via a failed password-login attempt on a QA-TEST
      account (fail-closed working again).
- [ ] All `[QA-TEST]`-tagged accounts and data archived/removed.
- [ ] Prod health check clean after the revert + cleanup deploy/restart.
