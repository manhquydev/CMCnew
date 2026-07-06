---
type: code-review
date: 2026-07-06
story: TEACHER-CMCVN-LMS-BRIDGE
---

# Teacher Surface Scope Code Review

## Findings

No blocking findings after the final correction.

The main review finding was fixed before this report: `family-intake` no longer renders finance copy/controls on the teacher surface. The teacher route still reuses the accepted `finance.receiptCreate` draft contract, but the visible teacher UI now says `Thông tin phụ huynh + học sinh` / `Tạo hồ sơ nháp` and hides voucher, discount, and prepay fields. Full receipt wording remains in ERP Finance only.

## Evidence

| Check | Result |
|---|---|
| `gitnexus impact ReceiptCreateCard --direction upstream` | LOW, 0 impacted callers/processes |
| `pnpm --filter @cmc/admin typecheck` | Pass |
| Focused admin nav tests | Pass, 21 tests |
| `pnpm --filter @cmc/admin build` | Pass |
| `scripts/verify-teacher-cmcvn-lms-bridge.ps1` | Pass, 13 Playwright tests plus API/UI/DB setup |
| `scripts/verify-teacher-cmcvn-live-smoke.ps1` | Pass on production, asset `/assets/index-fou0Ms-B.js` |
| `git diff --check` on final touched files | Pass, CRLF warnings only |

## Requirement Audit

| Requirement | Evidence | Status |
|---|---|---|
| Teacher host is not full ERP | Teacher nav E2E rejects Finance/CRM/HR/work-shift; production smoke shows `CMC Teacher Portal` | Proven except post-MFA prod session |
| Roles: teacher + business/training directors | Authenticated local E2E covers `giao_vien`, `giam_doc_kinh_doanh`, `giam_doc_dao_tao` | Proven locally |
| Existing API/db/auth reused | Implementation uses admin SPA, existing trpc, `receiptCreate`, session evidence, attendance, grade APIs | Proven by code/tests |
| Director one-form PH+HS intake with parent email | Intake form requires parent phone/name/email + student name, optional DOB/class | Proven by code and nav E2E presence |
| Director class/exercise workflow | Existing class/exercise flows retained; upload PDF RBAC and LMS autosave E2E cover exercise asset path | Proven by existing tests |
| Teacher assigned class attendance/comment/photo | API tests cover teacher ownership, attendance markAll, session evidence photos/comments publish | Proven by integration/E2E |
| Student homework experience | LMS Playwright covers PDF homework autosave and parent read-only view | Proven |
| Parent sees teacher interaction | Session evidence Playwright covers parent login/view of teacher note and summary | Proven |
| Production deployment | Admin rebuilt on VPS and live smoke pass | Proven for public shell/pre-login |

## Residual Risk

Production authenticated Microsoft MFA/post-login role experience is not directly proven without a real staff account/session. Automated evidence covers local authenticated roles and production public shell, asset, bundle marker, SSO authorize pre-login, and callback URI acceptance.

## Unresolved Questions

- Can an operator run the interactive SSO verifier with a real teacher/director Microsoft account to close the final production post-login gap?
