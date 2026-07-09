# Consolidated triage — 7-domain bug hunt (47 findings) + 4 known fixes

Date: 2026-07-09. Mode: report-only audit → triage here → fix confirmed, ask on high-risk/product.

## Part 0 — 4 known issues: FIXED (in working tree, not yet committed)
- Bug 1 server-truth session count (drop endDate) — `enumerateSessionsByCount` + count-mode gen. TDD green.
- Bug 2 auto-course UCREA L1 — shared `pickDefaultCourse` (program+level order). Both create surfaces.
- Bug 3 remove misleading "mã dự phòng" from intake — done (phone-login standard).
- Feature 4 /courses PDF preview — "Xem học liệu" via existing PdfAnnotator + `/files/exercise/:ref`.

## Part 1 — MUST-FIX, unambiguous (no product decision; fix now)

| ID | Sev | Domain | Defect | Fix |
|----|-----|--------|--------|-----|
| A1 | HIGH-privacy | attendance | `internalNote` leaked to LMS principal payload (`listForPrincipal`/`detailForPrincipal` include w/o select) | add explicit `select`, exclude internalNote |
| B1 | HIGH | attendance | **My Phase-2 regression**: comment-lock rejects entire `upsertDraft` on orphan comment (student later absent) → save bricked, no UI recovery | server drops/ignores comments for non-present students instead of 400; UI prunes stale comments |
| C1 | HIGH | attendance | `upsertDraft` update always sets `status='draft', publishedAt=null` → routine edit silently un-publishes; admin UI still says "Đã đăng" | don't reset publish state on draft-save of published record; reset `evidencePublished` correctly |
| C2 | HIGH | lms | `submission.save` no status guard → `submitted`/`graded` submission still mutable (moving target) | add status guard like `submit` (block save when submitted/graded) |
| C4 | HIGH | provisioning | provisioning emails/returns DEFAULT `Cmc2026@` even for returning family w/ different real password → phone-login fails (**real root cause of "mã không dùng được"**) | only surface default password for NEWLY-created accounts; for existing, don't claim a password |
| D3 | MED | provisioning | `finance.ts` existing-student dedup uses raw `receipt.parentPhone` not `normalizeLoginPhone` (decision 0033 D5) | normalize before match |
| D4 | MED | provisioning | lifecycle reactivation missing `logEvent` (decision 0040 §2 audit) | add audit event |
| E1 | HIGH (hr) | nav | `hr` default landing 403s (`defaultSection hr→'hr'` but payroll.roster directors-only) | route hr → safe section (schedule/overview) |
| F1 | MED | scheduling | `editSlot(applyToFuture)` relocates makeup sessions (missing `isMakeup:false`) | add filter |
| G1 | MED | auth | timing account-enumeration (early return before verifyPassword) | constant-time (dummy verify) — matches OTP hardening |

## Part 2 — NEEDS PRODUCT/HIGH-RISK DECISION (ask user)

| ID | Sev | Question |
|----|-----|----------|
| Q1 | MED-HIGH | **Enrollment re-enroll dead-end** (prov F3/F4, data F2): withdrawn/transferred student can't re-enroll same batch (unique has no status). Allow reactivate, or keep blocked? |
| Q2 | MED-HIGH | **Schema↔DB drift** `exercise.curriculum_unit_id` (schema nullable, DB NOT NULL). Fix = make schema NOT NULL (exercises always unit-bound) OR relax DB. Is a unit-less exercise ever valid? |
| Q3 | MED | **Attendance window director override**: 15-min gate blocks director/super_admin too (evening class un-markable after midnight). Add director/super_admin bypass to correct rosters? |
| Q4 | MED-HIGH | **Guardian dedup by NAME only** (prov F2, `studentDob` unused) → identical-name siblings mis-attach. Change dedup key to name+dob? (data-correctness, touches provisioning) |
| Q5 | MED | **Cancel session → recompute mapping** (class F5): cancel leaves stale curriculum labels. Recompute on cancel like generate/editSlot does? |
| Q6 | HIGH-infra | **CF rate-limit DoS** (auth HIGH-1): nginx lacks `real_ip_header CF-Connecting-IP` → `ctx.ip` = shared CF edge IP → 20 fails locks ALL users. Fix nginx real_ip for Cloudflare ranges. (infra/nginx change on server) |

## Part 3 — ACCEPTED / DEFER (documented, not fixing now)
- Student takeover via default pw + deterministic loginCode (auth MED-3) — decision-0033 accepted.
- `/files/exercise/:ref` serves any exercise PDF to any principal (lms F5) — decision-0022 accepted.
- nav F2 cockpit direct-URL 403 (no leak, panels 403) — low-priority UX; fix isReachableSection later.
- grade.maxScore stale on re-grade (lms F2), exercise.upsert destructive (lms F3), basePdfRef unvalidated (lms F4) — real but MED, batch later.
- LOW: tokenVersion non-atomic reset, logout no bump, room/voucher soft-delete collisions, overCapacity off-by-one, UTC/ICT skew in destructive-cancel filter, malformed startTime → 500.

## Source reports
`audit-{auth-session,class-curriculum-scheduling,lms-homework,attendance-grading-evidence,provisioning-enrollment,nav-rbac-surface,data-integrity}-findings.md`
