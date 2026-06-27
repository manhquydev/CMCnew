# Consolidated Findings Triage — 10-Agent Code Review (verify-260627-1201 wave)

Date: 2026-06-27 | Branch: develop | Mode: read-only triage + governance-doc fixes.

This report consolidates ALL findings from the five `verify-260627-1201-*` re-verification
reports (themselves adversarial re-checks of the 10-agent review in
`plans/reports/20260627-103314-10-agent-code-review/`) into one disposition table.

## Overall verdict on the review

The 10-agent review was **largely REAL** — almost every finding reproduces against live
`develop` code, and the re-verification found **0 outright-false, 0 fabricated** findings.
But it has three systematic distortions:

1. **Inflated severities.** Most "High" UI findings are real but defense-in-depth / UX only —
   the backend enforces `requirePermission` + RLS on every data call, so unguarded frontend
   chrome returns FORBIDDEN, not data. The re-verification down-rated the majority of UI
   "High" items to Medium/Low.
2. **Intentional design mislabeled as defects.** Several documented, decision-backed choices
   were reported as bugs (payroll RLS secrecy model, `student.detail` breadth, approved-KPI
   tree-override per decision-0011, manual-only certificates per decision-0008, staff-bell
   polling).
3. **Stale (pre-fix-wave) findings.** Source reports were generated ~10:33 before a fix wave;
   line numbers had drifted, and the governance docs referenced the retired `apps/teaching`.

## Disposition legend

- **FIXED** — corrected in this session (file named).
- **INTENTIONAL** — deliberate, documented design; no code defect.
- **FALSE/OVERBLOWN** — claim wrong or severity materially inflated.
- **DEFERRED** — real, low/medium, backlog.
- **DEFERRED-COND** — real but conditional on an unmet precondition (multi-facility, R6 Graph,
  multi-replica, live CI) or pure defense-in-depth.

## Triage table (all findings, de-duplicated)

| ID | Finding | Re-rated sev | Disposition | Note |
|----|---------|--------------|-------------|------|
| 10-1 | App topology docs stale after retiring `apps/teaching` (README dev cmd, charter) | Med | **FIXED** | README.md (removed `@cmc/teaching dev`, 2-app topology), docs/project-charter.md (2-app + staff-surface note) |
| 10-2 | TEST_MATRIX marks `implemented` where proof planned + cites retired app | High (governance) | **FIXED** | docs/TEST_MATRIX.md: BELL-NOTIF evidence→admin+ui, E2E truthful; TEACH-SHELL→`changed` (unified-staff-shell.spec.ts); TEACH-PAGINATE→`changed` (admin class-workspace) |
| 10-6 | Roadmap cites non-existent `teaching-smoke` E2E + retired shell | Med | **FIXED** | docs/roadmap.md: dropped teaching-smoke (→admin-smoke / unified-staff-shell), reworded "Teaching shell fully wired", backlog.md rows repointed to admin |
| 03-1 / auth-8 | Payroll RLS facility-wide, not row-owner secrecy | Low/Info | **INTENTIONAL** | Documented in migration; secrecy enforced at tRPC `requirePermission('payroll')`; `myPayslips` IDOR-safe (PAY-MYSLIP). No SQL path bypasses tRPC |
| auth-3 | `student.detail` viewable by any authenticated staff | Low/Info | **INTENTIONAL** | Explicit comment; facility-scoped by RLS; passwordHash excluded. Role-narrowing is a product-RBAC question, not a vuln |
| fin-5 | Approved KPI can still be overridden via `kpiOverride` | Low-Med | **INTENTIONAL** | decision-0011 tree-override: authorized + audited + self-blocked; payslip-finalize blocks recompute. Optional: lock approved rows (product call) |
| 05-6 | Manual certificates have no LMS read path | N/A | **INTENTIONAL** | decision-0008 (certificate manual-only; LMS = homework platform) |
| 08-1 | Staff-notif bell polling-only (30s) despite SSE contract | Low | **INTENTIONAL** | 30s staleness, no correctness/security impact; staff SSE channel is an enhancement |
| 09-4 | Email audit logs include recipient address + provider detail | Low | **INTENTIONAL** (policy) | PII-minimization is an open policy decision; not a defect |
| 05-4 / 06-5 | Term lock doesn't block source grade/qualitative mutations | Low | **FALSE/OVERBLOWN** | Reported "locked final output bypassable" — FALSE: `FinalGrade` only changes via `computeFinalGrade`, which IS lock-blocked. Residual is source-data drift while locked (policy gap), not a bypass |
| 03-4 | Receipt/class course consistency is API-only | Low | **FALSE/OVERBLOWN** | Real but well-mitigated: app guard + `receipt-batch-course-guard.int.test.ts` present. Cross-row equality would need a trigger; severity inflated |
| 03-2 | Facility counters collide with GLOBAL-unique `ClassBatch.code`/`Receipt.code` | High (latent) | **DEFERRED-COND** | Latent under single-facility; HARD blocker the moment a 2nd facility creates its first class/receipt each year. Fix: `@@unique([facilityId, code])` + collision int-test |
| 10-3 | CI runs neither `pnpm lint` nor Playwright E2E | Med-High | **DEFERRED-COND** | GH Actions billing blocked → CI not executing regardless; Jenkins planned. Add lint + E2E job when CI is live |
| 10-5 | SSO/ENTRA/GRAPH vars documented but absent from env template/compose | Med | **DEFERRED-COND** | Forward-looking (R6 Graph). Add to `.env.production.example` + compose passthrough (guarded) when wired |
| auth-2 | OTP dev fallback returns login codes outside production | Low | **DEFERRED-COND** | Prod hard-gated by `NODE_ENV!=='production'`. Harden: explicit `ALLOW_DEV_OTP_RESPONSE` opt-in |
| 09-1 | OTP request returns ok even when email send fails (newest-wins) | Med | **DEFERRED-COND** | Only bites once R6 Graph is live (currently `graphMailerFromEnv()===null`). Await/confirm send before invalidating prior codes |
| 09-2 | Email outbox claim not atomic across replicas | Low now | **DEFERRED-COND** | Documented single-instance scope; cron embedded per API process. Fix (FOR UPDATE SKIP LOCKED) only if prod runs >1 API replica |
| auth-5 / 09-+ | Public CRM `leadIngest` token-only, unthrottled, caller-chosen facility | Med | **DEFERRED-COND** | Shared static `CRM_LEAD_TOKEN`, no throttle, no max-len. Add IP/token throttle, max lengths, per-facility/server-pinned token |
| 06-2 | Class reopen restores manually-cancelled future sessions/meetings | Med | **DEFERRED-COND** | Provenance not tracked; reopen restores blindly. Add `cancelledByClassCancel` marker, restore only those rows |
| 07-1 / auth-9 | Admin hash deep-links render hidden panels regardless of role | Med | **DEFERRED-COND** | Frontend chrome only; tRPC calls server-gated → FORBIDDEN. Cosmetic/defense-in-depth |
| auth-1 / 09-5 | `staff_notification` RLS facility-only, not recipient-aware | Low | **DEFERRED-COND** | Every route already filters `recipientId = session.userId`; no current leak. Optional RLS recipient predicate (defense-in-depth) |
| 03-3 | `GradingTemplate` nullable `level` defeats `@@unique` | Med | **DEFERRED** | NULL treated distinct → duplicate default templates. Add partial unique `WHERE level IS NULL` / `NULLS NOT DISTINCT` / sentinel |
| 03-5 | Core numeric ranges lack DB CHECK constraints | Med | **DEFERRED** | Only Zod app-layer guards. Add CHECK (percent 0..100, amounts >=0) for non-API/seed writes |
| 10-4 | Root `pnpm test` omits `@cmc/api test:int` | Med | **DEFERRED** | Add a `verify` script chaining test + test:int + verify-rls, or document full local command |
| 10-7 | Screenshots easy to accidentally commit (.gitignore too narrow) | Low | **DEFERRED** | `.gitignore` matches only `*-verify.png`; add `*.png` (with allowlist) or `screenshots/` |
| auth-4 | RLS-hidden reads surface 500 (P2025) not NOT_FOUND in `student.detail` | Low-Med | **DEFERRED** | `mapRlsErrors` maps only 42501; `findUniqueOrThrow`→P2025→INTERNAL. Refutes in-code comment. Use `findUnique`+explicit NOT_FOUND |
| fin-1 | Receipt commission can attach to UNRELATED opportunity | High | **DEFERRED** | `receiptApprove` reads `opp.ownerId`/stage with no student/contact match; opp has no `studentId`. Needs canonical opp↔student link (product Q) |
| fin-2 | CRM actor can set arbitrary opportunity owner | Med | **DEFERRED** | `ownerId` free uuid at create (defaults self, auditable, create-only). Add tree/self check |
| fin-3 | KPI sales prefill undercounts `sent`/`reconciled` receipts | Med | **DEFERRED** | Commission counts `approved|sent|reconciled`; prefill counts `approved` only → understated `doanh_so`. Align filters |
| fin-4 | KPI confirm/approve lacks subject≠actor + manager-tree checks | Med | **DEFERRED** (partial) | SoD (confirmer≠approver) IS enforced+tested — do not contradict. Gaps: confirm self-subject, approve self-subject, no tree restriction |
| fin-6 | Salary grade cleared by empty string without reason | Low | **DEFERRED** | `''` is falsy → `gradeChanged=false` → clears band silently. HR-gated, narrow |
| 05-1 / auth-6 | Submission APIs return unpublished `score`/`feedback` to students/parents | High | **DEFERRED** | `gradeSelect` has no `isPublished` filter; only UI hides. Server-side suppress for LMS principals. Top correctness finding |
| 05-2 / auth-7 | Students can submit to unpublished/closed exercises by direct ID | Med | **DEFERRED** | `save`/`submit` load exercise with no `status==='published'`/`dueAt` guard. Assert before upsert |
| 05-3 | Grade score can exceed maxScore | Med | **DEFERRED** | zod `score>=0` only; never compared to `maxScore`. Inflates `norm10()`. Handler-side guard |
| 05-5 | Gift `program`/`minLevel` gates stored but not enforced | Low | **DEFERRED** | Feature unwired (`minLevel` unsettable). Enforce in redeem or drop columns (product) |
| 06-1 | Attendance can attach enrollment to wrong session | Med→High (integrity) | **DEFERRED** | `mark` never checks `enrollment.classBatchId===session.classBatchId`; trusts client facilityId. Corrupts attendance feeding final grade |
| 06-3 | UTC `today` boundary vs ICT business day | Low | **DEFERRED** | UTC-midnight cutoff wrong during ICT 00:00–06:59. Compute in Asia/Ho_Chi_Minh |
| 06-4 | Schedule slot/session facility integrity under-validated | Med | **DEFERRED** | `addSlot` writes client room/teacher unchecked; no facility match. Validate room/teacher facility |
| 07-2 | CSKH assign dropdown breaks for `cskh`+`quan_ly` (`user.list` excludes them) | High (functional) | **DEFERRED** | `afterSale.assign` roles get FORBIDDEN on `user.list` → dropdown errors → core CSKH flow broken. Add scoped `user.listAssignable`. Highest functional-impact item |
| 07-3 | CSKH lifecycle mutation button shown to unauthorized roles | Med | **DEFERRED** | `setStudentLifecycle` = `quan_ly` only; button rendered for all. Gate button (server enforces) |
| 07-4 | Class enroll exposes manual student-create (superadmin break-glass) | Med | **DEFERRED** | Button unconditional; `student.create` is superAdminProcedure → dead 403s. Hide unless superadmin |
| 07-5 | Finance student cache stale after approving new-student receipt | Low | **DEFERRED** | `approve()` refreshes receipts only, not student selector list. Refetch/invalidate |
| 07-6 | Clickable table rows mouse-only (a11y) | Med (a11y) | **DEFERRED** | No `tabIndex`/`role`/`onKeyDown`. Add keyboard activation |
| 08-2 | Student annotation state leaks onto a no-PDF exercise | Med | **DEFERRED** | Single persisted `ExerciseModal`; effect never clears annotation for no-PDF → prior marks saved/submitted. Data-integrity. Add `key={exercise.id}` or clear on close |
| 08-3 | LMS session expiry/revocation not reflected in shell | Low | **DEFERRED** | `connected=false` ignored; surfaces only on next 401/reload. Optional force logout |
| 08-4 | Parent OTP request failures have no visible error | Low | **DEFERRED** | `onOtpRequest` try/finally, no catch → silent. Add catch + error message |
| 09-3 | Callio transient failures: no retry/backoff | Low | **DEFERRED** | `fetchPeriodCdrs` no retry inside one txn → 429/5xx rolls back whole sync. Mitigated: manual, idempotent. Add bounded backoff |

## Disposition counts (de-duplicated)

- **FIXED (this session):** 3 — 10-1, 10-2, 10-6 (all governance docs).
- **INTENTIONAL:** 6 — payroll RLS, student.detail breadth, approved-KPI override (0011), manual certs (0008), staff-bell polling, email-audit PII.
- **FALSE/OVERBLOWN:** 2 — term-lock "bypass" (impact false), receipt/course API-only (mitigated, inflated).
- **DEFERRED-COND:** 10 — 03-2 (multi-facility), 10-3 (live CI), 10-5 (SSO/Graph R6), OTP dev fallback, OTP-await (R6), outbox multi-replica, lead-ingest throttle, class-reopen provenance, admin deep-link cosmetic, staff-notif defense-in-depth.
- **DEFERRED (plain backlog):** 24 — see table.

Note: counts de-dupe cross-report overlaps (auth-6==05-1, auth-7==05-2, auth-8==03-1, auth-9==07-1, auth-1==09-5, auth-5==09-+, 05-4==06-5).

## Backlog (DEFERRED + DEFERRED-COND), priority order

1. **fin-1** Receipt→opportunity commission mis-attribution (High; wrong commission VND) — needs canonical opp↔student link decision.
2. **05-1/auth-6** Unpublished grade leak to LMS students/parents (High; server-side suppression).
3. **07-2** CSKH assign dropdown broken for cskh/quan_ly (High functional) — add `user.listAssignable`.
4. **03-2** Facility code-counter collision (High, latent) — `@@unique([facilityId, code])` before 2nd facility launches.
5. **06-1** Attendance session/enrollment mismatch (integrity) — same-batch assertion + server-derived facilityId.
6. **05-3 / 05-2 / 06-4 / 06-2 / 08-2** Medium correctness/integrity — score≤maxScore, exercise-published guard, schedule facility validation, reopen provenance, annotation-leak.
7. **fin-2 / fin-3 / fin-4** CRM owner / KPI prefill parity / KPI subject-self+tree checks.
8. **10-3 / 10-4 / 10-5** CI lint+E2E (when CI live), local `verify` script, prod env-var template (SSO/Graph R6).
9. **DEFERRED-COND (conditional)** lead-ingest throttle, OTP await/dev-fallback (R6), outbox multi-replica, staff-notif RLS, admin deep-link guard — gate on R6 Graph / multi-replica / hardening passes.
10. **Low/UX/a11y** 07-1/3/4/5/6, 08-3/4, 09-3, 06-3, 03-3, 03-5, 10-7, fin-6, auth-4, 05-5.

## Unresolved questions (product/ops decisions, drive several severities)

- Multi-facility at launch? (gates 03-2 from latent → hard blocker)
- R6 Graph / SSO wired soon? (gates 09-1, 10-5, auth-2)
- >1 API replica in prod? (gates 09-2 outbox)
- Canonical opportunity↔student link for commission validation? (fin-1)
- Should KPI confirm/approve be management-tree-restricted, or is facility + SoD enough? (fin-4)
- Is unpublished score+feedback an intended "instant grade" UX, or a leak? (05-1)
- Which staff roles may see guardian PII / loginCode in `student.detail`? (auth-3)

Status: DONE
