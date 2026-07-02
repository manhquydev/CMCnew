# Journal Writer Session Report: 2026-07-01 Critical Events Documentation

**Date**: 2026-07-01 23:43  
**Session ID**: journal-writer (a5ebad03dbc41b285)  
**Status**: DONE  

---

## Summary

Documented four critical session events from July 1 in project journal format, covering shipping the RBAC role consolidation, fixing LMS CSP font-loading issues, resolving a critical database migration chain blocker, and syncing stale plan metadata. All entries follow the project's engineering diarist conventions (honest technical details, root cause analysis, lessons learned, no softening of failures).

---

## Events Documented

### 1. RBAC Role Consolidation Shipped (Commit 27849d3)

**File**: `docs/journals/260701-2231-rbac-role-consolidation-shipped.md` (68 lines)

- **What**: Consolidated 12 RBAC roles → 9 by retiring `quan_ly`, `head_teacher`, `bgd` and delegating permissions to two directors
- **Scope**: 68 files changed (1642 insertions, 560 deletions)
- **Key lesson**: Wide permission changes need pre-flight scanning + permission-parity testing before refactor
- **Severity**: High
- **Status**: Resolved (commit `27849d3`)

**Findings**:
- All 11 admin UI panels re-targeted to new director model
- Shift-registration escalation rewired to resolve approver by shift group domain
- ESLint errors caught during lint phase (6 unused test bindings)
- Director guide updated (29 lines changed, 9 stale sections corrected)

### 2. LMS Fonts & CSP Prod Hardening (Commit 5471869)

**File**: `docs/journals/260701-2232-lms-fonts-csp-prod-hardening.md` (72 lines)

- **What**: Google Fonts blocked by prod CSP; self-hosted Fredoka/Quicksand via `@fontsource-variable`; hardened showcase route matching
- **Scope**: 2 npm packages added, 13 files changed (118 insertions, 25 deletions)
- **Key lesson**: CSP testing must be part of pre-deployment validation; route matchers should use suffix checks for base-path deployments
- **Severity**: Medium
- **Status**: Resolved (commit `5471869`)

**Findings**:
- Claymorphic redesign (June 25) was beautiful on dev but silently broken in prod
- Route matching (`exact '/showcase'`) was fragile under reverse proxy base paths
- No CSP header validation in dev/test environment caused blind spot

### 3. Work-Shift Migration Chain Fix — Critical Production Blocker (Commit 28a1c9c)

**File**: `docs/journals/260701-2254-work-shift-migration-chain-fix-critical.md` (122 lines)

- **What**: Discovered 7 work-shift tables + 2 enums + 4 StaffNotifEvent values + db-push drift were never captured in migrations, breaking any fresh or prod deploy at the RLS migration step
- **Scope**: 2 new migrations (179 lines DDL), 54-migration chain verified from empty
- **Key lesson**: `prisma db push` is a footgun without discipline (every `db push` must have a corresponding migration before commit); pre-merge CI must run fresh-DB migration tests
- **Severity**: Critical
- **Status**: Resolved (commit `28a1c9c`)

**Findings**:
- Tables: shift_group, shift_template, shift_registration, shift_registration_entry, time_punch, facility_network, shift_code_counter
- Additional drift: employment_profile.manager_id column + index, receipt→student FK onDelete change, dropped id defaults
- Migration chain tested on scratch DB (`cmc_migtest`): all 54 migrations apply, zero drift post-apply
- Prod DB (`cmcnew-prod-postgres-1`) backed up and manually migrated with checksum verification
- Work-shift test suite: 7/7 passing post-fix

**Risk flagged but not yet fixed**:
- No `.gitattributes` `eol=lf` rule for `*.sql` files; Windows checkouts with `core.autocrlf=true` can cause CRLF checksum mismatches

### 4. Plan Status Sync: RBAC Completion (Metadata Housekeeping)

**File**: `docs/journals/260701-2300-plan-sync-rbac-completion-status.md` (83 lines)

- **What**: Plan `plans/260701-1906-hr-role-consolidation/plan.md` was marked `in-progress` despite work being complete
- **Scope**: 1 plan file requires status update
- **Key lesson**: Plan status should be updated in the same commit as the final code; consider CI/CD checks for stale plan metadata
- **Severity**: Low
- **Status**: Identified (requires plan file update)

**Findings**:
- Phase 1–4 are all complete per commit verification
- Plan metadata was 6+ hours behind code completion
- No automatic sync mechanism between code commits and plan status

---

## Journal Conventions Followed

All entries adhere to the project's engineering diarist format:

✅ **Root cause stated without euphemism** — "the dev team was using `db push` as a shortcut" instead of "an oversight occurred"  
✅ **Specific technical details included** — error types, file paths, commit hashes, line counts  
✅ **Decisions documented** — why `@fontsource` was chosen over S3-hosted fonts; why shift group domain drives escalation  
✅ **Lessons extractable** — every entry ends with 2–5 actionable lessons  
✅ **Emotional reality captured** — frustration with CSP silent breakage, anger at `db push` discipline gap  
✅ **Next steps actionable** — clear [x] done / [ ] pending items with ownership  

---

## File Inventory

| File | Lines | Severity | Commit(s) |
|------|-------|----------|-----------|
| `260701-2231-rbac-role-consolidation-shipped.md` | 68 | High | 27849d3 |
| `260701-2232-lms-fonts-csp-prod-hardening.md` | 72 | Medium | 5471869 |
| `260701-2254-work-shift-migration-chain-fix-critical.md` | 122 | Critical | 28a1c9c |
| `260701-2300-plan-sync-rbac-completion-status.md` | 83 | Low | — (metadata) |
| **Total** | **345** | — | 3 commits |

All files follow the naming convention: `YYMMDD-HHMM-<slug>.md`

---

## Verification Checklist

- [x] All 4 journal entries created in `docs/journals/`
- [x] Names follow project timestamp-based convention (no collisions with existing entries)
- [x] Commits verified via `git log` and `git show --stat`
- [x] Technical details spot-checked against migration files, test suites, and code
- [x] Root causes extracted from git diffs and file contents
- [x] Lessons learned are specific and actionable
- [x] Emotional/honest language present without unprofessionalism
- [x] Next steps are clear and include ownership/timeline

---

## Unresolved Questions

1. **Plan status update**: Should `plans/260701-1906-hr-role-consolidation/plan.md` be updated as part of this session, or left for the feature owner? (Recommend: update now as part of commit housekeeping.)

2. **CRLF checksum latent risk**: Should `.gitattributes` `eol=lf` rule be added pre-emptively, or only if Windows devs report migration re-runs? (Recommend: add now; it's a 1-line fix and prevents future pain.)

3. **Pre-merge CI for migrations**: Should a fresh-DB migration test be added to CI/CD before the next feature lands, or after the next similar incident? (Recommend: add now; migration chain fragility is a recurring pain point.)

---

## Session Outcome

All key technical events from July 1 have been documented with brutal honesty about failures, specific technical details, and actionable lessons. The journal entries form a durable record for future maintainers to understand what broke, why, and how to prevent similar issues.

**Status**: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT

→ **DONE**

One minor concern: plan metadata (question #1 above) should be addressed in a follow-up commit to complete the housekeeping work. No blocking issues.

---

**Created**: 2026-07-01 23:43 UTC  
**Session ID**: a5ebad03dbc41b285 (journal-writer)  
**Authored by**: Claude Code (Haiku 4.5)  
