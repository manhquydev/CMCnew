# Phase 03 — CRM → student provisioning (Stages 4-6)

## Context links
- Design: `plans/reports/brainstorm-260705-1006-e2e-full-lifecycle-walkthrough-guide-report.md`
- Flow facts: `plans/reports/brainstorm-260705-0944-enrollment-session-provisioning-friction-report.md`
- Decisions: `docs/decisions/0033-student-login-phone-identity.md`, `docs/decisions/0030-email-brevo-external-transport-split.md`

## Overview
- Date: 2026-07-05
- Description: Sale/CSKH runs a CRM lead O1→O5 (student name + parent phone). Then Sale creates a Receipt from the O5 info; Ke_toan approves it; approval atomically creates Student + ParentAccount + Enrollment + LMS StudentAccount. Parent account email is sent (real to manhquy.mqy@gmail.com) and the received email is screenshotted (or outbox-verified per stage-0 decision).
- Priority: P1
- Implementation status: pending
- Review status: not reviewed

## Key Insights
- CRM (Contact/Opportunity O1-O5) does NOT touch Student. Reaching O5 produces NO student — this is by design (decision 0033), not a bug. The guide MUST state this explicitly to kill the "học sinh biến mất" confusion.
- Student is created ONLY at `finance.receiptApprove` (`apps/api/src/routers/finance.ts:770-812`) — atomic: Student (+ dedupe by parent phone + student name, `finance.ts:770-787`), ParentAccount, Enrollment (if classBatchId on receipt), LMS StudentAccount. `createdByReceiptId` records provenance.
- studentCode derives from receipt code: `HS + code.substring(2)` (`finance.ts:790`).
- The receipt must carry `classBatchId` (the class from phase 2) for the Enrollment to be created — otherwise student exists but is not enrolled. Confirm the receipt form links the class.
- Parent email: sent via outbox → Brevo transport (external recipient). If stage-0 found Brevo keys absent, the outbox row is created but not delivered → verify the outbox row instead of the inbox.

## Requirements
- CRM opportunity advanced O1→O5 with a distinct student name + parent phone (use manhquy.mqy@gmail.com as parent email so stage 6 lands in a real inbox).
- Receipt created from O5 info, linked to the phase-2 class, then approved by ke_toan.
- Post-approve: Student + ParentAccount + Enrollment + StudentAccount all exist (verified).
- Parent account/activation email: real send + screenshot, OR outbox-row verification + note.

## Architecture
- Admin ERP `:5173`: CRM module (Contact/Opportunity pipeline), Finance module (Receipt create + approve).
- Routers: `apps/api/src/routers/crm.ts` (lead/opportunity), `apps/api/src/routers/finance.ts` (receipt create + `receiptApprove`).
- Email: `apps/api/src/services/email-outbox.ts`, `apps/api/src/lib/email-routing.ts`, `apps/api/src/lib/brevo-client.ts`.

## Related code files
- `apps/api/src/routers/crm.ts` (opportunity stages O1-O5)
- `apps/api/src/routers/finance.ts:770-812` (atomic provisioning at approve)
- `apps/api/src/services/email-outbox.ts` (queue + worker)
- `apps/api/src/lib/email-routing.ts` (Brevo vs Graph routing for external recipient)

## Implementation Steps
1. Login as sale/cskh at :5173. CRM → create Contact + Opportunity. Enter student name + parent phone + parent email = manhquy.mqy@gmail.com.
2. Advance the opportunity O1 → O2 → ... → O5 (won). Screenshot each stage transition (or at least O1 start + O5 won).
3. At O5, screenshot the state and note in guide: "chưa có học sinh trong hệ thống là ĐÚNG thiết kế — bước tiếp theo là tạo Phiếu thu" (decision 0033).
4. Login/switch to sale → Finance → create Receipt: fill student name + parent phone + parent email from the O5 info; LINK the phase-2 class (classBatchId). Screenshot.
5. Login/switch to ke_toan → Finance → approve the receipt. Screenshot the approve action + result.
6. Verify atomic provisioning (queries below). Screenshot the newly-created student record in UI.
7. Parent email:
   - If Brevo configured (stage 0): open manhquy.mqy@gmail.com, screenshot the received parent account/activation email. Capture the activation/login link.
   - If not configured: query the outbox row, screenshot it, note "email fallback = outbox verified (Brevo key absent locally)".

## Verify queries (read-only)
- No student before approve: after O5, `SELECT count(*) FROM "Student";` → still 0.
- After approve, all four exist:
  - `SELECT id, "studentCode", "createdByReceiptId" FROM "Student" ORDER BY "createdAt" DESC LIMIT 1;`
  - `SELECT * FROM "ParentAccount" WHERE phone = '<parentPhone>';`
  - `SELECT * FROM "Enrollment" WHERE "studentId" = <id>;` (present only if receipt had classBatchId)
  - StudentAccount / LMS account row for the student.
- Email: `SELECT id, "to", subject, status, transport FROM "EmailOutbox" ORDER BY "createdAt" DESC LIMIT 1;`

## Todo list
- [ ] CRM O1→O5 run with student name + parent phone + parent email — screenshots
- [ ] O5 "no student yet" explained in guide (decision 0033)
- [ ] Receipt created (linked to class) — screenshot
- [ ] ke_toan approves — screenshot
- [ ] atomic Student+Parent+Enrollment+StudentAccount verified via queries
- [ ] parent email received (real) or outbox verified — screenshot
- [ ] guides written: `04-crm-o1-o5/`, `05-receipt-approve/`, `06-parent-email/` (roles: Sale/CSKH, Kế toán)

## Success Criteria
- O5 reached with zero students (design confirmed).
- After approve: Student + ParentAccount + Enrollment + StudentAccount all present, linked to phase-2 class.
- Parent email delivered to real inbox (screenshot) OR outbox row verified with recorded reason.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Receipt form has no field to link class → no Enrollment | Med | High | confirm classBatchId on receipt; if UI lacks it, log bug + enroll separately so stage 8 works; note as gap |
| Dedupe merges into unexpected existing student | Low | Med | clean DB from P1 means no prior students; verify createdByReceiptId set (new student) |
| Brevo send fails silently | Med | Low | pre-decided outbox fallback; screenshot outbox row |
| Parent email uses Graph (blocked externally) instead of Brevo | Med | Med | check `transport` column = brevo; if graph → won't deliver externally, fall back to outbox verify + note |
| O5→receipt handoff has no prefilled data (manual retype) | High | Low | expected current behavior (0944 improvement is out of scope) — document manual retype in guide |

## Security Considerations
- Parent email = the designated test inbox only. No real customer PII.
- Screenshots of the received email must not expose the activation token in a way that is reusable post-run; crop or note it is a local-only token.
- Do not commit `EmailOutbox` dumps containing tokens.

## Next steps
Proceed to Phase 04 (parent/student portal login, attendance, evaluation, photo upload, parent-side verify).
