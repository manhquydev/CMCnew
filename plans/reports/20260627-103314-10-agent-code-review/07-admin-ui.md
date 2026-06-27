# 07 Admin UI

Status: DONE

## Scope Reviewed

- `apps/admin/src/**`
- shared UI pieces in `packages/ui/src/**`
- `apps/admin/src/__tests__/nav-consistency.test.ts`
- `apps/e2e/tests/admin-smoke.spec.ts`
- `apps/e2e/tests/admin-hr-panel.spec.ts`
- `apps/e2e/tests/unified-staff-shell.spec.ts`
- backend permission/router files where needed to verify UI/API mismatch

## Findings

### High: Hash deep links bypass nav permission gating

Evidence:

- `apps/admin/src/App.tsx:549`
- `apps/admin/src/App.tsx:568`
- `apps/admin/src/App.tsx:596`
- nav gating only in `apps/admin/src/shell.tsx:356`

Impact: staff can land on hidden panels such as `#kpi`, `#org`, `#guardians`, then hit backend `FORBIDDEN` or see controls they cannot use.

### High: CSKH assignment flow breaks for roles that can assign cases

Evidence:

- `apps/admin/src/cskh-panel.tsx:96`
- `packages/auth/src/permissions.ts:28`
- `packages/auth/src/permissions.ts:31`
- `packages/auth/src/permissions.ts:211`

Impact: `cskh`/`quan_ly` can open a valid assignment workflow but staff dropdown depends on `user.list`, which those roles cannot call.

### High: CSKH panel exposes student lifecycle mutation to unauthorized users

Evidence:

- `apps/admin/src/cskh-panel.tsx:358`
- `apps/api/src/routers/aftersale.ts:117`
- `packages/auth/src/permissions.ts:25`
- `packages/auth/src/permissions.ts:32`

Impact: `cskh` and `giam_doc_kinh_doanh` see/submit financial-impact lifecycle actions that API rejects.

### High: Class enrollment still exposes manual student creation

Evidence:

- `apps/admin/src/class-workspace.tsx:337`
- `apps/admin/src/class-workspace.tsx:352`
- `apps/admin/src/class-workspace.tsx:451`
- `apps/api/src/routers/student.ts:102`
- `apps/api/src/routers/student.ts:105`
- `apps/e2e/tests/unified-staff-shell.spec.ts:5`

Impact: normal class managers see dead/manual create UI despite server marking `student.create` as super-admin break-glass and product flow requiring receipt approval.

### Medium: Finance student cache stale after approving new-student receipt

Evidence:

- `apps/api/src/routers/finance.ts:267`
- `apps/admin/src/finance-panel.tsx:454`
- `apps/admin/src/finance-panel.tsx:873`

Impact: newly provisioned student does not appear in existing-student receipt selector until reload.

### Medium: Clickable table rows are mouse-only

Evidence:

- `apps/admin/src/class-workspace.tsx:912`
- `apps/admin/src/class-workspace.tsx:916`
- `packages/ui/src/data-table.tsx:201`

Impact: keyboard-only users cannot activate row navigation/detail workflows.

## Verification Gaps

- No tests/build run due read-only scope.
- E2E is mostly super-admin smoke.
- No role-specific forbidden-action visibility tests.
- No hash deep-link tests.
- No CSKH assignment/lifecycle flow tests.
- `apps/admin/src/__tests__/nav-consistency.test.ts` appears inconsistent with `NAV_GATES.org`.

## Positive Controls

- Backend permission registry is centralized.
- `NAV_GATES` exists and most nav visibility derives from `can()`.
- Finance receipt approve path has strong atomicity/provisioning guards.
- Several panels have loading/error/retry states.
- E2E covers login, admin smoke, HR nav visibility, notification button, and new-student receipt form reachability.

## Unresolved Questions

- Should directors manage users from Admin, or should `org` be super-admin-only?
- Should CSKH users assign only to self/team through narrower staff-picker endpoint?
- Should class enrollment remove manual student creation or show only super-admin break-glass UI?

