# 08 Teaching and LMS UI

Status: DONE

## Scope Reviewed

- `apps/lms/src/**`
- `packages/ui/src/login-gate.tsx`
- `packages/ui/src/lms-login-gate.tsx`
- `packages/ui/src/use-staff-notif.ts`
- `packages/ui/src/notification-stream.ts`
- LMS and unified shell E2E tests

Note: `apps/teaching` does not exist in this repo; teaching-origin shell appears consolidated into admin staff shell.

## Findings

### High: Staff notification bell is polling-only despite SSE contract

Evidence:

- polling hook: `packages/ui/src/use-staff-notif.ts:17`
- interval: `packages/ui/src/use-staff-notif.ts:60`
- backend SSE exists: `apps/api/src/index.ts:208`
- admin shell uses polling hook: `apps/admin/src/shell.tsx:206`

Impact: staff bell can be stale up to 30 seconds and does not satisfy SSE-fed behavior.

### High: Student annotation state can leak to another no-PDF exercise

Evidence:

- `Exercise.basePdfRef` optional: `packages/db/prisma/schema.prisma:502`
- modal reset does not clear annotation/teacherLayer for no-PDF: `apps/lms/src/student-view.tsx:117`
- submit sends `annotationLayer`: `apps/lms/src/student-view.tsx:169`

Impact: a student can accidentally save prior PDF marks onto a different text-only exercise.

### Medium: LMS session expiry/revocation is not reflected in shell

Evidence:

- server SSE revalidates and breaks: `apps/api/src/index.ts:189`
- client only sets `connected=false`: `packages/ui/src/notification-stream.ts:48`
- callers ignore connected state: `apps/lms/src/student-view.tsx:837`, `apps/lms/src/parent-view.tsx:631`
- logout waits for server before clearing principal: `packages/ui/src/lms-login-gate.tsx:117`

Impact: user can remain in stale shell until reload after revocation/expired cookie.

### Medium: Parent OTP request failures have no visible error

Evidence:

- backend can reject/throttle: `apps/api/src/routers/lms-auth.ts:70`
- UI `try/finally` has no catch/error state: `packages/ui/src/lms-login-gate.tsx:70`

Impact: rate-limit/network/email failure silently leaves parent on same form.

## Verification Gaps

- LMS E2E parent flow stops before OTP login.
- Student E2E only checks login/logout.
- No staff notification real-time E2E.
- No role-filtered shell hiding E2E for restricted staff.

## Positive Controls

- LMS route separation for student/parent is clean.
- Parent/student identities use separate LMS auth gate.
- Notification history is scoped by LMS student ids.
- Student reward mutation refreshes balance/gifts.
- Active nav contrast follows design guidance.

## Unresolved Questions

- Is standalone Teaching app intentionally removed? README still references it.
- Should parent accounts redeem rewards or view only?

