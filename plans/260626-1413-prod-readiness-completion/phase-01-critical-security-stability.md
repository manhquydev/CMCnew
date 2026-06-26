# Phase 01 — Critical Security & Stability

**Risk:** HIGH (auth, authorization, container security) | **Depends:** none

## Requirements

Vá các critical/high không cần product decision, đảm bảo không regression auth/authz.

## Files & Changes

### 1. C4 — API container as non-root
- `apps/api/Dockerfile`: thêm trước `CMD`:
  ```dockerfile
  RUN addgroup -S cmc && adduser -S cmc -G cmc && chown -R cmc:cmc /app
  USER cmc
  ```
- Verify: container chạy, `/api/health` = 200, `whoami` ≠ root.

### 2. C1 — Rate limit login (in-memory, theo Q1)
- New `apps/api/src/rate-limit.ts`: fixed-window Map, `checkLoginLimit(ip,id)` + `clearLoginLimit(ip,id)`. IP+id: 5/15ph; IP: 20/15ph. GC quét key hết hạn.
- `apps/api/src/context.ts`: expose `ip` từ `x-forwarded-for` (nginx set, single trusted ingress).
- `apps/api/src/routers/auth.ts:~22`: `checkLoginLimit(ctx.ip, input.email)` đầu mutation; `clearLoginLimit` sau login thành công.
- `apps/api/src/routers/lms-auth.ts`: tương tự cho `loginParent` (emailOrPhone) + `loginStudent` (loginCode).
- TRPCError code `TOO_MANY_REQUESTS`.

### 3. C6 — audit.timeline IDOR
- `apps/api/src/routers/audit.ts:22-25`: áp NOTE_TARGETS whitelist + entity visibility pre-check (copy pattern `postNote`/`followers`). Reject FORBIDDEN nếu entityType không whitelisted; NOT_FOUND nếu entity không visible.
- RLS: restrict `record_event` rows `facility_id IS NULL` chỉ cho super_admin (migration ALTER POLICY). → đẩy SQL sang Phase 02 migration nếu cần DB, nhưng app-layer check là chính.

### 4. C7 — LMS SSE re-validate
- `apps/api/src/index.ts:165-186` `/sse/notifications`: trong `while(!stream.aborted)` thêm `resolveLmsSession(token)` mỗi tick; break nếu null/đổi accountId; refresh ownedIds (guardian changes). Copy từ `/sse/staff` (213-223).

### 5. C9 + H14 — Cookie secure + TLS posture
- `auth.ts:32` + `lms-auth.ts:22`: `secure: process.env.COOKIE_SECURE !== 'false'` (default true mọi nơi).
- `index.ts`: startup guard `if (NODE_ENV==='production' && !process.env.CORS_ORIGINS) throw`.
- TLS termination thực tế: document trong docs (nginx TLS / upstream LB) — không block code.

### 6. H19/H20 — Teaching role guards
- `apps/teaching/src/level-approval-panel.tsx`: guard `head_teacher|quan_ly|isSuperAdmin`, else access-denied.
- `apps/teaching/src/certificate-panel.tsx`: issue chỉ `head_teacher|quan_ly|isSuperAdmin`; role khác xem read-only.
- `apps/teaching/src/shell.tsx` buildGroups: gate `enrollment`/`levelup`/`certificate` nav theo role.

### 7. H21 — Admin nav role gate
- `apps/admin/src/shell.tsx`: `org` + `guardians` visible chỉ `isSuperAdmin || canHr || quan_ly|bgd`.

### 8. Badge icon bug
- `packages/ui/src/badge-shelf.tsx:38`: `b.badge.iconUrl ? <img .../> : <Text fz={32}>🏅</Text>`. Thêm loader khi `badges===null`.

### 9. C8 — Auth integration tests
- `apps/api/test/auth-login.int.test.ts`: wrong password→UNAUTHORIZED, inactive→FORBIDDEN, logout invalidates, tokenVersion bump blocks old session, rate-limit→TOO_MANY_REQUESTS sau ngưỡng.

## Validation

- `pnpm --filter @cmc/api typecheck` + admin/teaching typecheck green.
- New auth int-test pass.
- Live: login sai 6 lần → 429; SSE LMS đóng khi account deactivate; non-privileged role không thấy/không approve level-up.

## Risks / Rollback

- Rate-limit ngưỡng quá chặt khóa nhầm user thật → ngưỡng cấu hình được, reset on success.
- Cookie secure=true trên môi trường HTTP dev → set `COOKIE_SECURE=false` trong `.env` local.
- Mỗi thay đổi nhỏ, revert độc lập per-file.
