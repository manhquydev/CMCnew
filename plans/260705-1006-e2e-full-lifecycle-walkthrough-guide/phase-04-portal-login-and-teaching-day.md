# Phase 04 — Portal login & teaching day (Stages 7-8)

## Context links
- Design: `plans/reports/brainstorm-260705-1006-e2e-full-lifecycle-walkthrough-guide-report.md`
- Decisions: `docs/decisions/0033-student-login-phone-identity.md`, `docs/decisions/0034-manual-attendance-daily-ticket.md`

## Overview
- Date: 2026-07-05
- Description: Parent/student log into the LMS portal via phone-login (Netflix-profile picker). On the session day the teacher marks attendance (điểm danh), writes a student review/evaluation (nhận xét/đánh giá), and uploads class photos. Finally verify the parent sees the evaluation + photos in the portal — the end goal of the whole run.
- Priority: P1 (final proof)
- Implementation status: pending
- Review status: not reviewed

## Key Insights
- LMS phone-login = Netflix-profile flow (decision 0033), implemented in `apps/api/src/routers/lms-auth.ts`: `loginFamilyByPhone` (`lms-auth.ts:62`) resolves the parent phone → children list; `enterChildProfile` (`lms-auth.ts:84`) selects a child profile. Both are `publicProcedure` (run before a session exists). OTP path (`otpRequest`/`otpVerify`, `lms-auth.ts:111-131`) is the alternate.
- LMS portal URL `http://localhost:5175`; session cookie `cmc.lms` (`LMS_COOKIE_NAME`, `.env.example:12`). `COOKIE_SECURE=false` required for localhost (set in P1).
- Attendance requires the ClassSession from phase 2 to exist AND the student to be enrolled (phase 3). Attendance is a manual daily-ticket flow (decision 0034) — `apps/api/src/routers/attendance.ts` (`mark`/`markAll`).
- Class photos stored on disk: `SESSION_PHOTO_STORE_DIR=./.data/session-photos` (`.env.example:44`). Parent visibility of photos + evaluation is the acceptance target.
- Session "day": the generated ClassSession has a date; teacher actions may be gated to the session date. If today ≠ session date, either pick a session dated today or note the date-gating behavior (do not fake system time on shared stack).

## Requirements
- Parent logs into :5175 by phone (the parent phone from phase 3), selects the child profile, sees the enrolled class.
- Student profile also reachable (same phone-login, child profile).
- Teacher (phase 2) marks attendance for the session, writes an evaluation, uploads ≥1 class photo.
- Parent view shows the evaluation + uploaded photo(s).

## Architecture
- LMS portal `:5175` (apps/lms) — parent/student.
- Admin ERP `:5173` (apps/admin) — teacher attendance + evaluation + photo upload.
- Routers: `apps/api/src/routers/lms-auth.ts` (phone login), `attendance.ts` (mark), evaluation router, session-photo upload router, `guardian.ts` (parent-facing reads).

## Related code files
- `apps/api/src/routers/lms-auth.ts:43-135` (loginFamilyByPhone, enterChildProfile, otp)
- `apps/api/src/routers/attendance.ts` (mark/markAll — requires ClassSession)
- `apps/api/src/routers/guardian.ts` (parent portal reads)
- `apps/lms/*` (portal UI, phone-login screen, child profile picker)
- session-photo upload router + `SESSION_PHOTO_STORE_DIR`

## Implementation Steps
1. Open LMS portal `http://localhost:5175`. Enter the parent phone from phase 3 (`loginFamilyByPhone`). Screenshot the phone-login screen.
2. Netflix-style profile picker appears → select the child profile (`enterChildProfile`). Screenshot the picker + landing showing the enrolled class.
3. (If OTP required) request OTP → verify. If OTP email goes external, reuse the stage-0 email decision (real inbox vs outbox). Screenshot.
4. Confirm student sees their class/schedule. Screenshot.
5. Switch to teacher (login :5173 with teacher password from phase 2). Open the class session for the target date.
6. Điểm danh: mark the student present (attendance.mark). Screenshot.
7. Nhận xét/đánh giá: write an evaluation for the student. Screenshot.
8. Upload ≥1 class photo to the session. Screenshot the upload + success.
9. Return to the LMS portal (parent view, :5175). Verify the evaluation text + uploaded photo(s) are visible to the parent. Screenshot — THIS is the final acceptance proof.

## Verify queries (read-only)
- Parent phone resolves children: `SELECT * FROM "ParentAccount" WHERE phone = '<parentPhone>';`
- Attendance row: `SELECT * FROM "Attendance" WHERE "classSessionId" = <id> AND "studentId" = <id>;`
- Evaluation row exists for the student/session.
- Photo blob file present under `./.data/session-photos/` + DB row linking it to the session.

## Todo list
- [ ] parent phone-login + child profile select — screenshots
- [ ] student profile reachable, sees class — screenshot
- [ ] teacher marks attendance — screenshot
- [ ] teacher writes evaluation — screenshot
- [ ] teacher uploads class photo — screenshot
- [ ] parent portal shows evaluation + photo — final screenshot
- [ ] guides written: `07-portal-login/`, `08-teaching-day/` (roles: PH/HS, Giáo viên → PH)
- [ ] `docs/guides/e2e-walkthrough/README.md` index finalized (role → stages, URLs, test creds table)

## Success Criteria
- Parent logs in by phone and lands on the child's enrolled class.
- Teacher completes attendance + evaluation + photo upload for the session.
- Parent portal renders the evaluation + photo(s) — end-to-end proof captured.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Session date-gating blocks teacher actions today | Med | High | pick/generate a session dated today in P2; else document date behavior, don't fake clock |
| Phone-login can't find child (parent account not linked) | Med | High | verify ParentAccount + guardian link created in P3; fix+commit if provisioning gap |
| OTP required + email external + Brevo absent | Med | Med | reuse P1 fallback; if OTP blocks login entirely, log blocking bug + note manual OTP retrieval from outbox |
| Photo upload disk dir missing/permissions | Low | Med | ensure `./.data/session-photos` exists/writable; create dir if needed (config, not code) |
| Parent view does not surface evaluation/photo | Med | High | trace guardian.ts read path; if broken → blocking bug (this is the acceptance target), fix+commit |
| `cmc.lms` cookie dropped (Secure on http) | Low | High | confirm COOKIE_SECURE=false from P1 |

## Security Considerations
- Test parent phone + child data only; no real family PII.
- Screenshots of the portal must not expose the OTP code or LMS session cookie value.
- Uploaded photos = non-sensitive test images (no real minors). Do not commit photo blobs.

## Next steps
- Finalize `docs/guides/e2e-walkthrough/README.md` and per-stage guides.
- Ensure `reports/bug-log.md` reflects all fixed + backlog items.
- Post-run: hand back to review report 0944 for the 4 process improvements (separate plan, out of scope here).
